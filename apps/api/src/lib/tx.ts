import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { claimIdempotencyKey, storeIdempotentResponse } from "./idempotency.js";
import { withRetry } from "./retry.js";
import { DEFAULT_TX_TIMEOUTS, type TxTimeouts } from "./tx-options.js";

/**
 * What every write module (sales, purchases, ...) shares: one interactive
 * transaction per request, retried as a whole on deadlock, with the
 * Idempotency-Key claimed and answered inside that same transaction.
 */

export interface TxContext {
  tx: Prisma.TransactionClient;
  /** Counts database round trips so the service can log them. */
  queries: { count: number };
}

export function counted(ctx: TxContext): void {
  ctx.queries.count += 1;
}

export interface WriteResponse {
  status: number;
  body: unknown;
  replayed: boolean;
}

/** `SET LOCAL` only: it ends with the transaction, so it is safe on any connection. */
export async function setLocalTimeouts(ctx: TxContext, lockTimeoutMs: number): Promise<void> {
  counted(ctx);
  // `lockTimeoutMs` is a validated integer, never user input.
  await ctx.tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${Math.trunc(lockTimeoutMs)}ms'`);
}

export interface AuditWrite {
  actorId: string;
  action: string;
  entityId: string;
  beforeData?: Prisma.InputJsonValue;
  afterData: Prisma.InputJsonValue;
  metadata: Prisma.InputJsonValue;
}

export async function insertAuditLog(ctx: TxContext, entityType: string, audit: AuditWrite): Promise<void> {
  counted(ctx);
  await ctx.tx.auditLog.create({
    data: {
      actorId: audit.actorId,
      action: audit.action,
      entityType,
      entityId: audit.entityId,
      beforeData: audit.beforeData,
      afterData: audit.afterData,
      metadata: audit.metadata,
    },
  });
}

export interface WriteRunnerOptions {
  prisma: PrismaClient;
  now: () => Date;
  log?: (entry: Record<string, unknown>) => void;
  txTimeouts?: TxTimeouts;
}

export function createWriteRunner(options: WriteRunnerOptions) {
  const { prisma, now } = options;
  const log = options.log ?? (() => undefined);
  const timeouts = options.txTimeouts ?? DEFAULT_TX_TIMEOUTS;

  /** One transaction per attempt; deadlocks are retried as a whole, and every attempt is logged with its statement count. */
  async function runWrite(
    route: string,
    extra: Record<string, unknown>,
    work: (ctx: TxContext) => Promise<WriteResponse>,
  ): Promise<WriteResponse> {
    let attempts = 0;
    return withRetry(
      async () => {
        attempts += 1;
        const startedAt = Date.now();
        const queries = { count: 0 };
        const result = await prisma.$transaction(
          async (tx) => {
            const ctx: TxContext = { tx, queries };
            await setLocalTimeouts(ctx, timeouts.lockTimeoutMs);
            return work(ctx);
          },
          { timeout: timeouts.timeoutMs, maxWait: timeouts.maxWaitMs },
        );
        log({
          route,
          txMs: Date.now() - startedAt,
          queries: queries.count,
          attempts,
          replayed: result.replayed,
          ...extra,
        });
        return result;
      },
      { onRetry: (attempt) => log({ route, retry: attempt }) },
    );
  }

  /**
   * Claims the Idempotency-Key inside the transaction (see lib/idempotency.ts),
   * runs the work, and stores the response in the same transaction so the
   * replay can never disagree with what was committed.
   */
  async function withIdempotency(
    ctx: TxContext,
    input: { actorId: string; route: string; key: string | null; requestHash: string },
    work: () => Promise<{ status: number; body: unknown }>,
  ): Promise<WriteResponse> {
    let claimId: string | null = null;
    if (input.key !== null) {
      ctx.queries.count += 3;
      const claim = await claimIdempotencyKey(ctx.tx, {
        actorId: input.actorId,
        key: input.key,
        route: input.route,
        requestHash: input.requestHash,
        now: now(),
      });
      if (claim.kind === "replay") {
        ctx.queries.count += 1;
        return { status: claim.status, body: claim.body, replayed: true };
      }
      claimId = claim.id;
    }
    const outcome = await work();
    if (claimId !== null) {
      ctx.queries.count += 1;
      await storeIdempotentResponse(ctx.tx, claimId, outcome.status, outcome.body as Prisma.InputJsonValue);
    }
    return { ...outcome, replayed: false };
  }

  return { runWrite, withIdempotency };
}
