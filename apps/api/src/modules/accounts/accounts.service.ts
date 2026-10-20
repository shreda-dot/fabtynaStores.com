import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import {
  assertAccountAcceptsNewEntries,
  assertAccountDeactivatable,
  assertNotFutureOccurredAt,
  buildAccountLedgerEntry,
  buildAccountReversals,
  buildAccountTransfer,
  buildOpeningBalanceEntry,
  buildReconcileAdjustment,
  formatNaira,
  getLagosBusinessDate,
  type Account,
  type AccountEntryType,
  type AccountLedgerEntry,
} from "@fabtyna/shared";
import type { Actor } from "../../auth/actor.js";
import { businessRuleError, validationError, AppError } from "../../lib/errors.js";
import { hashRequestBody } from "../../lib/idempotency.js";
import {
  decodeCursor,
  encodeCursor,
  addOneDay,
  lagosDayStartIso,
  resolveListDateRange,
  utcTimestamp,
} from "../../lib/list-helpers.js";
import { lockAccounts, type LockedAccount } from "../../lib/locks.js";
import {
  counted,
  createWriteRunner,
  insertAuditLog,
  type TxContext,
  type WriteResponse,
} from "../../lib/tx.js";
import type { TxTimeouts } from "../../lib/tx-options.js";
import type {
  accountMovementSchema,
  accountTransferSchema,
  createAccountSchema,
  openingBalanceSchema,
  reconcileAccountSchema,
} from "./accounts.schemas.js";
import type { z } from "zod";

type CreateAccountBody = z.infer<typeof createAccountSchema>;
type OpeningBalanceBody = z.infer<typeof openingBalanceSchema>;
type ReconcileBody = z.infer<typeof reconcileAccountSchema>;
type MovementBody = z.infer<typeof accountMovementSchema>;
type TransferBody = z.infer<typeof accountTransferSchema>;

const newId = (): string => randomUUID();
const transferCreateRoute = "POST /account-transfers";

export interface AccountsServiceOptions {
  prisma: PrismaClient;
  now?: () => Date;
  log?: (entry: Record<string, unknown>) => void;
  txTimeouts?: TxTimeouts;
  maxDateRangeDays?: number;
}

function asDomainAccount(account: LockedAccount): Account {
  const epoch = new Date(0);
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    isActive: account.isActive,
    deactivatedAt: account.isActive ? null : epoch,
    note: null,
    createdAt: epoch,
    updatedAt: epoch,
  };
}

function accountDto(row: {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  deactivatedAt: Date | null;
  createdAt: Date;
  balanceKobo: bigint;
}) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    isActive: row.isActive,
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    balanceKobo: row.balanceKobo.toString(),
  };
}

function mapDomainError<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof RangeError) throw businessRuleError(error.message);
    throw error;
  }
}

function entryDto(entry: AccountLedgerEntry) {
  return {
    id: entry.id,
    accountId: entry.accountId,
    type: entry.type,
    amountKobo: entry.amountKobo.toString(),
    occurredAt: entry.occurredAt.toISOString(),
    note: entry.note,
    reversesEntryId: entry.reversesEntryId,
  };
}

async function createLedgerRows(ctx: TxContext, entries: readonly AccountLedgerEntry[]): Promise<void> {
  if (entries.length === 0) return;
  counted(ctx);
  await ctx.tx.accountLedgerEntry.createMany({ data: entries.map((entry) => ({ ...entry })) });
}

async function requireLockedAccount(ctx: TxContext, accountId: string): Promise<LockedAccount> {
  const locked = await lockAccounts(ctx, [accountId]);
  const account = locked.get(accountId);
  if (account === undefined) throw new AppError(404, "NOT_FOUND", "Account not found.", { accountId });
  return account;
}

export function createAccountsService(options: AccountsServiceOptions) {
  const { prisma } = options;
  const now = options.now ?? (() => new Date());
  const maxDateRangeDays = options.maxDateRangeDays ?? 366;
  const runner = createWriteRunner({
    prisma,
    now,
    log: options.log,
    txTimeouts: options.txTimeouts,
  });

  function write<T>(
    route: string,
    extra: Record<string, unknown>,
    body: unknown,
    actor: Actor,
    key: string | null,
    status: number,
    operation: (ctx: TxContext) => Promise<{ entityId: string; entityType: string; action: string; before?: unknown; after: unknown; metadata?: unknown }>,
  ): Promise<WriteResponse> {
    return runner.runWrite(route, extra, async (ctx) =>
      runner.withIdempotency(ctx, { route, key, requestHash: hashRequestBody(body) }, async () => {
        const result = await operation(ctx);
        await insertAuditLog(ctx, result.entityType, {
          actorId: actor.id,
          action: result.action,
          entityId: result.entityId,
          beforeData: result.before as Prisma.InputJsonValue | undefined,
          afterData: result.after as Prisma.InputJsonValue,
          metadata: (result.metadata ?? {}) as Prisma.InputJsonValue,
        });
        return { status, body: result.after };
      }),
    );
  }

  async function loadEntries(ctx: TxContext, accountIds: readonly string[]) {
    counted(ctx);
    return ctx.tx.accountLedgerEntry.findMany({
      where: { accountId: { in: [...accountIds] } },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    });
  }

  async function reverseEntries(
    ctx: TxContext,
    targets: readonly AccountLedgerEntry[],
    reason: string,
  ): Promise<AccountLedgerEntry[]> {
    const accountIds = targets.map((entry) => entry.accountId);
    const locked = await lockAccounts(ctx, accountIds);
    const accounts = [...locked.values()].map(asDomainAccount);
    const existing = await loadEntries(ctx, accountIds);
    return mapDomainError(() =>
      buildAccountReversals(targets, existing, accounts, now(), newId, reason.trim()),
    );
  }

  return {
    async list(includeInactive: boolean) {
      const rows = await prisma.$queryRaw<Array<{
        id: string;
        name: string;
        type: "CASH" | "BANK" | "POS";
        isActive: boolean;
        deactivatedAt: Date | null;
        createdAt: Date;
        balanceKobo: bigint;
      }>>`
        SELECT a.id, a.name, a.type::text AS type, a."isActive", a."deactivatedAt", a."createdAt",
               COALESCE(ab."balanceKobo", 0)::bigint AS "balanceKobo"
          FROM accounts a
          LEFT JOIN account_balances ab ON ab."accountId" = a.id
         WHERE ${includeInactive} OR a."isActive"
         ORDER BY a."isActive" DESC, a.name ASC, a.id ASC`;
      return rows.map(accountDto);
    },

    async create(body: CreateAccountBody, actor: Actor, key: string | null) {
      const route = "POST /accounts";
      return write(route, {}, body, actor, key, 201, async (ctx) => {
        counted(ctx);
        const created = await ctx.tx.account.create({
          data: { name: body.name.trim(), type: body.type, isActive: true },
        });
        const after = accountDto({ ...created, balanceKobo: 0n });
        return { entityId: created.id, entityType: "Account", action: "ACCOUNT_CREATED", after };
      });
    },

    async rename(accountId: string, name: string, actor: Actor, key: string | null) {
      const route = `PATCH /accounts/${accountId}`;
      return write(route, { accountId }, { name }, actor, key, 200, async (ctx) => {
        const locked = await requireLockedAccount(ctx, accountId);
        counted(ctx);
        const beforeRow = await ctx.tx.account.findUnique({ where: { id: accountId } });
        if (beforeRow === null) throw new AppError(404, "NOT_FOUND", "Account not found.", { accountId });
        counted(ctx);
        const updated = await ctx.tx.account.update({ where: { id: accountId }, data: { name: name.trim() } });
        const before = accountDto({ ...beforeRow, balanceKobo: locked.balanceKobo });
        const after = accountDto({ ...updated, balanceKobo: locked.balanceKobo });
        return { entityId: accountId, entityType: "Account", action: "ACCOUNT_RENAMED", before, after };
      });
    },

    async setActive(accountId: string, isActive: boolean, actor: Actor, key: string | null) {
      const suffix = isActive ? "reactivate" : "deactivate";
      const route = `POST /accounts/${accountId}/${suffix}`;
      return write(route, { accountId }, { isActive }, actor, key, 200, async (ctx) => {
        const locked = await requireLockedAccount(ctx, accountId);
        if (!isActive && locked.isActive) {
          mapDomainError(() => assertAccountDeactivatable(asDomainAccount(locked), locked.balanceKobo));
        }
        counted(ctx);
        const beforeRow = await ctx.tx.account.findUnique({ where: { id: accountId } });
        if (beforeRow === null) throw new AppError(404, "NOT_FOUND", "Account not found.", { accountId });
        counted(ctx);
        const changedAt = now();
        const updated = await ctx.tx.account.update({
          where: { id: accountId },
          data: {
            isActive,
            deactivatedAt: isActive ? null : changedAt,
            updatedAt: changedAt,
          },
        });
        const before = accountDto({ ...beforeRow, balanceKobo: locked.balanceKobo });
        const after = accountDto({ ...updated, balanceKobo: locked.balanceKobo });
        return {
          entityId: accountId,
          entityType: "Account",
          action: isActive ? "ACCOUNT_REACTIVATED" : "ACCOUNT_DEACTIVATED",
          before,
          after,
        };
      });
    },

    async openingBalance(accountId: string, body: OpeningBalanceBody, actor: Actor, key: string | null) {
      const route = `POST /accounts/${accountId}/opening-balance`;
      return write(route, { accountId }, body, actor, key, 201, async (ctx) => {
        const account = await requireLockedAccount(ctx, accountId);
        mapDomainError(() => assertAccountAcceptsNewEntries(asDomainAccount(account), false));
        const entries = await loadEntries(ctx, [accountId]);
        const occurredAt = body.occurredAt ? new Date(body.occurredAt) : now();
        assertNotFutureOccurredAt(occurredAt, getLagosBusinessDate(now()));
        const entry = mapDomainError(() =>
          buildOpeningBalanceEntry(
            {
              accountId,
              amountKobo: BigInt(body.amountKobo),
              occurredAt,
              note: body.note ?? "Opening balance",
            },
            entries,
            newId,
          ),
        );
        await createLedgerRows(ctx, [entry]);
        return {
          entityId: entry.id,
          entityType: "AccountLedgerEntry",
          action: "ACCOUNT_OPENING_BALANCE_RECORDED",
          after: entryDto(entry),
        };
      });
    },

    async reconcile(accountId: string, body: ReconcileBody, actor: Actor, key: string | null) {
      const route = `POST /accounts/${accountId}/reconcile`;
      return write(route, { accountId }, body, actor, key, 201, async (ctx) => {
        const account = await requireLockedAccount(ctx, accountId);
        mapDomainError(() => assertAccountAcceptsNewEntries(asDomainAccount(account), false));
        const countedBalance = BigInt(body.countedAmountKobo);
        const deltaKobo = countedBalance - account.balanceKobo;
        if (deltaKobo === 0n) {
          throw businessRuleError("There is nothing to adjust; the counted amount matches the account balance.");
        }
        const occurredAt = body.occurredAt ? new Date(body.occurredAt) : now();
        assertNotFutureOccurredAt(occurredAt, getLagosBusinessDate(now()));
        const entry = mapDomainError(() =>
          buildReconcileAdjustment(
            { accountId, deltaKobo, note: body.reason.trim(), occurredAt },
            asDomainAccount(account),
            account.balanceKobo,
            newId,
          ),
        );
        await createLedgerRows(ctx, [entry]);
        return {
          entityId: entry.id,
          entityType: "AccountLedgerEntry",
          action: "ACCOUNT_RECONCILED",
          after: entryDto(entry),
        };
      });
    },

    async movement(accountId: string, body: MovementBody, actor: Actor, key: string | null) {
      const route = `POST /accounts/${accountId}/movements`;
      return write(route, { accountId }, body, actor, key, 201, async (ctx) => {
        const account = await requireLockedAccount(ctx, accountId);
        mapDomainError(() => assertAccountAcceptsNewEntries(asDomainAccount(account), false));
        const occurredAt = body.occurredAt ? new Date(body.occurredAt) : now();
        assertNotFutureOccurredAt(occurredAt, getLagosBusinessDate(now()));
        const amount = BigInt(body.amountKobo);
        const isOutflow = body.type === "OWNER_DRAWING" || body.type === "BANK_OR_POS_CHARGE";
        if (isOutflow && account.balanceKobo < amount) {
          throw businessRuleError(
            `Cannot spend ${formatNaira(amount)} from ${account.name} (balance ${formatNaira(account.balanceKobo)}): record income or reconcile first.`,
            { accountId },
          );
        }
        const type: AccountEntryType = body.type;
        const entry = buildAccountLedgerEntry(
          {
            accountId,
            type,
            amountKobo: isOutflow ? -amount : amount,
            note: body.note?.trim() || null,
            occurredAt,
          },
          newId,
        );
        await createLedgerRows(ctx, [entry]);
        return { entityId: entry.id, entityType: "AccountLedgerEntry", action: "ACCOUNT_MOVEMENT_RECORDED", after: entryDto(entry) };
      });
    },

    async transfer(body: TransferBody, actor: Actor, key: string | null) {
      return write(transferCreateRoute, {}, body, actor, key, 201, async (ctx) => {
        const locked = await lockAccounts(ctx, [body.fromAccountId, body.toAccountId]);
        const from = locked.get(body.fromAccountId);
        const to = locked.get(body.toAccountId);
        if (from === undefined) throw new AppError(404, "NOT_FOUND", "Source account not found.", { accountId: body.fromAccountId });
        if (to === undefined) throw new AppError(404, "NOT_FOUND", "Destination account not found.", { accountId: body.toAccountId });
        const occurredAt = body.occurredAt ? new Date(body.occurredAt) : now();
        assertNotFutureOccurredAt(occurredAt, getLagosBusinessDate(now()));
        const built = mapDomainError(() =>
          buildAccountTransfer(
            {
              fromAccountId: body.fromAccountId,
              toAccountId: body.toAccountId,
              amountKobo: BigInt(body.amountKobo),
              note: body.note?.trim() || null,
              occurredAt,
            },
            [asDomainAccount(from), asDomainAccount(to)],
            from.balanceKobo,
            newId,
          ),
        );
        counted(ctx);
        await ctx.tx.accountTransfer.create({ data: { ...built.transfer } });
        await createLedgerRows(ctx, built.entries);
        const after = {
          id: built.transfer.id,
          fromAccountId: built.transfer.fromAccountId,
          toAccountId: built.transfer.toAccountId,
          amountKobo: built.transfer.amountKobo.toString(),
          note: built.transfer.note,
          occurredAt: built.transfer.occurredAt.toISOString(),
          entries: built.entries.map(entryDto),
        };
        return {
          entityId: built.transfer.id,
          entityType: "AccountTransfer",
          action: "ACCOUNT_TRANSFER_CREATED",
          after,
        };
      });
    },

    async reverseEntry(entryId: string, reason: string, actor: Actor, key: string | null) {
      const route = `POST /account-entries/${entryId}/reverse`;
      return write(route, { entryId }, { reason }, actor, key, 201, async (ctx) => {
        counted(ctx);
        const target = await ctx.tx.accountLedgerEntry.findUnique({ where: { id: entryId } });
        if (target === null) throw new AppError(404, "NOT_FOUND", "Account entry not found.", { entryId });
        if (target.reversesEntryId !== null) {
          throw businessRuleError("A reversal cannot be reversed.", { entryId });
        }
        if (!["OWNER_CAPITAL", "OWNER_DRAWING", "OTHER_INCOME", "BANK_OR_POS_CHARGE"].includes(target.type)) {
          throw businessRuleError("Only manual money movements can be reversed here.", { entryId });
        }
        const entries = await reverseEntries(ctx, [target], reason);
        await createLedgerRows(ctx, entries);
        return {
          entityId: entryId,
          entityType: "AccountLedgerEntry",
          action: "ACCOUNT_ENTRY_REVERSED",
          after: { target: entryDto(target), reversal: entries.map(entryDto), reason: reason.trim() },
        };
      });
    },

    async reverseTransfer(transferId: string, reason: string, actor: Actor, key: string | null) {
      const route = `POST /account-transfers/${transferId}/reverse`;
      return write(route, { transferId }, { reason }, actor, key, 201, async (ctx) => {
        counted(ctx);
        const transfer = await ctx.tx.accountTransfer.findUnique({ where: { id: transferId } });
        if (transfer === null) throw new AppError(404, "NOT_FOUND", "Account transfer not found.", { transferId });
        counted(ctx);
        const targets = await ctx.tx.accountLedgerEntry.findMany({
          where: { accountTransferId: transferId, reversesEntryId: null },
          orderBy: [{ accountId: "asc" }, { id: "asc" }],
        });
        if (targets.length !== 2) {
          throw businessRuleError("This transfer no longer has two live ledger entries.", { transferId });
        }
        const reversals = await reverseEntries(ctx, targets, reason);
        await createLedgerRows(ctx, reversals);
        return {
          entityId: transferId,
          entityType: "AccountTransfer",
          action: "ACCOUNT_TRANSFER_REVERSED",
          after: {
            id: transferId,
            reason: reason.trim(),
            reversals: reversals.map(entryDto),
          },
        };
      });
    },

    async statement(accountId: string, query: { from?: string; to?: string; limit: number; cursor?: string }) {
      const account = await prisma.account.findUnique({ where: { id: accountId }, select: { id: true, name: true } });
      if (account === null) throw new AppError(404, "NOT_FOUND", "Account not found.", { accountId });
      const range = resolveListDateRange(query, now(), maxDateRangeDays, {
        defaultToToday: true,
        suppressDefault: false,
      });
      const start = range.from as string;
      const end = range.to as string;
      const startAt = utcTimestamp(lagosDayStartIso(start));
      const endAt = utcTimestamp(lagosDayStartIso(addOneDay(end)));
      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      const cursorCondition =
        cursor === null
          ? Prisma.empty
          : Prisma.sql`WHERE (r."occurredAt" > ${utcTimestamp(cursor.at)}
                OR (r."occurredAt" = ${utcTimestamp(cursor.at)} AND r.id > ${cursor.id}))`;
      const rows = await prisma.$queryRaw<Array<{
        id: string | null;
        type: string | null;
        amountKobo: string | null;
        occurredAt: Date | null;
        note: string | null;
        reversesEntryId: string | null;
        sourceDescription: string | null;
        runningBalanceKobo: string | null;
        openingBalanceKobo: string;
        closingBalanceKobo: string;
      }>>`
        WITH opening AS (
          SELECT COALESCE(SUM("amountKobo"), 0)::text AS balance
            FROM account_ledger_entries
           WHERE "accountId" = ${accountId} AND "occurredAt" < ${startAt}
        ),
        ranged AS (
          SELECT ale.id, ale.type::text AS type, ale."amountKobo"::text AS "amountKobo",
                 ale."occurredAt", ale.note, ale."reversesEntryId",
                 CASE
                   WHEN ale."expenseId" IS NOT NULL THEN 'Expense: ' || e.description
                   WHEN ale."purchaseId" IS NOT NULL THEN 'Purchase: ' || COALESCE(p.reference, ale."purchaseId")
                   WHEN ale."salePaymentId" IS NOT NULL THEN 'Sale payment'
                   WHEN ale."supplierPaymentId" IS NOT NULL THEN 'Supplier payment'
                   WHEN ale."accountTransferId" IS NOT NULL THEN 'Account transfer'
                   WHEN ale."loanRepaymentId" IS NOT NULL THEN 'Loan repayment'
                   WHEN ale."loanId" IS NOT NULL THEN 'Loan disbursement'
                   ELSE COALESCE(ale.note, replace(ale.type::text, '_', ' '))
                 END AS "sourceDescription",
                 SUM(ale."amountKobo") OVER (ORDER BY ale."occurredAt", ale.id)::text AS "rangeRunningKobo"
            FROM account_ledger_entries ale
            LEFT JOIN expenses e ON e.id = ale."expenseId"
            LEFT JOIN purchases p ON p.id = ale."purchaseId"
           WHERE ale."accountId" = ${accountId}
             AND ale."occurredAt" >= ${startAt}
             AND ale."occurredAt" < ${endAt}
        ),
        totals AS (
          SELECT opening.balance AS opening,
                 (opening.balance::bigint + COALESCE((SELECT SUM("amountKobo"::bigint) FROM ranged), 0))::text AS closing
            FROM opening
        ),
        page AS (
          SELECT r.* FROM ranged r
          ${cursorCondition}
          ORDER BY r."occurredAt", r.id
          LIMIT ${query.limit + 1}
        )
        SELECT page.id, page.type, page."amountKobo", page."occurredAt", page.note,
               page."reversesEntryId", page."sourceDescription",
               (totals.opening::bigint + page."rangeRunningKobo"::bigint)::text AS "runningBalanceKobo",
               totals.opening AS "openingBalanceKobo", totals.closing AS "closingBalanceKobo"
          FROM totals LEFT JOIN page ON TRUE
         ORDER BY page."occurredAt" NULLS FIRST, page.id NULLS FIRST`;
      const entries = rows.filter((row) => row.id !== null).slice(0, query.limit);
      const first = rows[0];
      const last = entries.at(-1);
      const nextCursor =
        rows.filter((row) => row.id !== null).length > query.limit && last?.occurredAt
          ? encodeCursor({ at: last.occurredAt.toISOString(), id: last.id as string })
          : null;
      const openingBalanceKobo = first?.openingBalanceKobo ?? "0";
      const closingBalanceKobo = first?.closingBalanceKobo ?? openingBalanceKobo;
      return {
        account,
        from: range.from,
        to: range.to,
        openingBalanceKobo,
        closingBalanceKobo,
        entries: entries.map((entry) => ({
          id: entry.id,
          type: entry.type,
          amountKobo: entry.amountKobo,
          occurredAt: entry.occurredAt?.toISOString() ?? null,
          note: entry.note,
          sourceDescription: entry.sourceDescription,
          reversed: entry.reversesEntryId !== null,
          reversesEntryId: entry.reversesEntryId,
          runningBalanceKobo: entry.runningBalanceKobo,
        })),
        nextCursor,
      };
    },
  };
}
