import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "./errors.js";

/** How long a stored response can be replayed. Documented in docs/AI_CONTEXT.md. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

type TransactionClient = Prisma.TransactionClient;

/** Stable JSON: object keys sorted at every depth, so key order cannot change the hash. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function hashRequestBody(body: unknown): string {
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

export type IdempotencyClaim =
  | { kind: "claimed"; id: string }
  | { kind: "replay"; status: number; body: unknown };

/**
 * Claims (key, route, actor) INSIDE the caller's transaction.
 *
 * The database indexes scope new claims to an actor. Existing NULL-actor rows
 * are checked separately and conflict rather than replaying an unknown user's
 * response. If another request by this actor holds the key but has not
 * finished, the insert waits for it; after commit the stored response replays,
 * and after rollback this request owns the key.
 */
export async function claimIdempotencyKey(
  tx: TransactionClient,
  input: { actorId: string; key: string; route: string; requestHash: string; now: Date },
): Promise<IdempotencyClaim> {
  const { actorId, key, route, requestHash, now } = input;

  // An expired row must not block a fresh request with a reused key.
  await tx.idempotencyKey.deleteMany({
    where: { key, route, expiresAt: { lt: now } },
  });

  const legacy = await tx.idempotencyKey.findFirst({
    where: { key, route, actorId: null, expiresAt: { gte: now } },
    select: { id: true },
  });
  if (legacy !== null) {
    throw new AppError(
      409,
      "CONFLICT",
      "This Idempotency-Key belongs to an older request. Use a new key and retry.",
      { key },
    );
  }

  const id = randomUUID();
  const created = await tx.idempotencyKey.createMany({
    data: [
      {
        id,
        key,
        route,
        actorId,
        requestHash,
        expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
      },
    ],
    skipDuplicates: true,
  });
  if (created.count === 1) {
    return { kind: "claimed", id };
  }

  const existing = await tx.idempotencyKey.findFirst({
    where: { key, route, actorId },
  });
  if (existing === null) {
    // Deleted between the insert and the read (expiry cleanup): ask the client to retry.
    throw new AppError(409, "CONFLICT", "The idempotency key was just released. Please retry.");
  }
  if (existing.requestHash !== requestHash) {
    throw new AppError(
      422,
      "IDEMPOTENCY_MISMATCH",
      "This Idempotency-Key was already used with a different request body.",
      { key },
    );
  }
  if (existing.responseStatus === null) {
    throw new AppError(409, "CONFLICT", "A request with this Idempotency-Key is still in progress.");
  }
  return { kind: "replay", status: existing.responseStatus, body: existing.responseBody };
}

export async function storeIdempotentResponse(
  tx: TransactionClient,
  id: string,
  status: number,
  body: Prisma.InputJsonValue,
): Promise<void> {
  await tx.idempotencyKey.update({
    where: { id },
    data: { responseStatus: status, responseBody: body },
  });
}

/**
 * Deletes expired keys in small batches so one purge never holds a long lock or
 * a large transaction. Returns how many rows were removed.
 */
export async function purgeExpiredIdempotencyKeys(
  prisma: PrismaClient,
  options: { batchSize?: number; maxBatches?: number } = {},
): Promise<number> {
  const batchSize = options.batchSize ?? 500;
  const maxBatches = options.maxBatches ?? 20;
  let total = 0;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    // `expiresAt` is a UTC `timestamp without time zone`, as Prisma writes it.
    const removed = await prisma.$executeRaw`
      DELETE FROM idempotency_keys
       WHERE id IN (
         SELECT id FROM idempotency_keys
          WHERE "expiresAt" < (now() AT TIME ZONE 'UTC')
          ORDER BY "expiresAt"
          LIMIT ${batchSize}
       )`;
    total += removed;
    if (removed < batchSize) {
      break;
    }
  }
  return total;
}

/** Runs the purge on a timer. The timer never keeps the process alive. */
export function startIdempotencyCleanup(
  prisma: PrismaClient,
  options: {
    intervalMs?: number;
    onError?: (error: unknown) => void;
    onPurged?: (removed: number) => void;
  } = {},
): () => void {
  const timer = setInterval(() => {
    purgeExpiredIdempotencyKeys(prisma)
      .then((removed) => {
        if (removed > 0) options.onPurged?.(removed);
      })
      .catch((error: unknown) => options.onError?.(error));
  }, options.intervalMs ?? 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
