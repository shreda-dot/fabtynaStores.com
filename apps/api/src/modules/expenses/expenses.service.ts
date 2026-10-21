import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import {
  assertAccountAcceptsNewEntries,
  buildAccountLedgerEntry,
  buildAccountReversals,
  formatNaira,
  splitExpenseByChannel,
  type Account,
  type AccountLedgerEntry,
} from "@fabtyna/shared";
import type { Actor } from "../../auth/actor.js";
import { lockAccounts, type LockedAccount } from "../../lib/locks.js";
import { AppError, businessRuleError, validationError } from "../../lib/errors.js";
import { hashRequestBody } from "../../lib/idempotency.js";
import {
  createWriteRunner,
  counted,
  insertAuditLog,
  type TxContext,
  type WriteResponse,
} from "../../lib/tx.js";
import type { TxTimeouts } from "../../lib/tx-options.js";
import { assertNotInFuture } from "../sales/sales.validation.js";
import { listExpenses, summarizeExpenses } from "./expenses.queries.js";
import type {
  CreateExpenseBody,
  ExpenseSummaryQuery,
  ListExpensesQuery,
} from "./expenses.schemas.js";

interface CategoryRow {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
}

const id = (): string => randomUUID();
const createRoute = "POST /expenses";
const voidRoute = (expenseId: string): string => `POST /expenses/${expenseId}/void`;
const amendRoute = (expenseId: string): string => `PUT /expenses/${expenseId}`;

export interface ExpensesServiceOptions {
  prisma: PrismaClient;
  now?: () => Date;
  log?: (entry: Record<string, unknown>) => void;
  txTimeouts?: TxTimeouts;
  maxDateRangeDays?: number;
}

function domainAccount(account: LockedAccount): Account {
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

function assertCanSpend(
  account: LockedAccount,
  amountKobo: bigint,
  availableBalanceKobo = account.balanceKobo,
): void {
  try {
    assertAccountAcceptsNewEntries(domainAccount(account), false);
    if (availableBalanceKobo < amountKobo) {
      throw new RangeError(
        `Cannot spend ${formatNaira(amountKobo)} from ${account.name} (balance ${formatNaira(availableBalanceKobo)}): record income or reconcile first.`,
      );
    }
  } catch (error) {
    if (error instanceof RangeError) throw businessRuleError(error.message, { accountId: account.id });
    throw error;
  }
}

function expenseDto(
  row: {
    id: string;
    categoryId: string;
    channel: string;
    description: string;
    amountKobo: bigint;
    expenseDate: Date;
    voidedAt: Date | null;
    voidReason: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  category: Pick<CategoryRow, "name">,
  account: Pick<LockedAccount, "id" | "name">,
) {
  return {
    id: row.id,
    categoryId: row.categoryId,
    categoryName: category.name,
    accountId: account.id,
    accountName: account.name,
    channel: row.channel,
    description: row.description,
    amountKobo: row.amountKobo.toString(),
    expenseDate: row.expenseDate.toISOString(),
    voided: row.voidedAt !== null,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    voidReason: row.voidReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function lockCategory(ctx: TxContext, categoryId: string): Promise<CategoryRow> {
  counted(ctx);
  const rows = await ctx.tx.$queryRaw<CategoryRow[]>`
    SELECT id, name, code, "isActive"
      FROM expense_categories
     WHERE id = ${categoryId}
     FOR SHARE`;
  const category = rows[0];
  if (category === undefined) throw validationError("Expense category not found.", { categoryId });
  if (!category.isActive) {
    throw businessRuleError(`Expense category '${category.name}' is inactive.`, { categoryId });
  }
  return category;
}

async function loadAccountEntries(ctx: TxContext, accountIds: readonly string[]): Promise<AccountLedgerEntry[]> {
  if (accountIds.length === 0) return [];
  counted(ctx);
  return ctx.tx.accountLedgerEntry.findMany({
    where: { accountId: { in: [...accountIds] } },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  });
}

async function lockExpense(ctx: TxContext, expenseId: string) {
  counted(ctx);
  const rows = await ctx.tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM expenses WHERE id = ${expenseId} FOR UPDATE`;
  if (rows.length === 0) throw new AppError(404, "NOT_FOUND", "Expense not found.", { id: expenseId });
  counted(ctx);
  const expense = await ctx.tx.expense.findUnique({ where: { id: expenseId } });
  if (expense === null) throw validationError("Expense not found.", { id: expenseId });
  return expense;
}

function createLedgerEntry(
  body: CreateExpenseBody,
  expenseId: string,
  occurredAt: Date,
): AccountLedgerEntry {
  return buildAccountLedgerEntry(
    {
      accountId: body.accountId,
      type: "EXPENSE",
      amountKobo: -BigInt(body.amountKobo),
      expenseId,
      occurredAt,
      note: body.description,
    },
    id,
  );
}

export function createExpensesService(options: ExpensesServiceOptions) {
  const { prisma } = options;
  const now = options.now ?? (() => new Date());
  const maxDateRangeDays = options.maxDateRangeDays ?? 366;
  const runner = createWriteRunner({
    prisma,
    now,
    log: options.log,
    txTimeouts: options.txTimeouts,
  });

  async function createInTransaction(
    ctx: TxContext,
    body: CreateExpenseBody,
    actor: Actor,
    amendedFromExpenseId: string | null = null,
  ) {
    const occurredAt = new Date(body.expenseDate);
    assertNotInFuture(occurredAt, now(), "expenseDate", "Expense date");
    const category = await lockCategory(ctx, body.categoryId);
    if (category.code === "LOAN_INTEREST") {
      throw businessRuleError("LOAN_INTEREST is reserved for interest created by a loan repayment.");
    }

    const accounts = await lockAccounts(ctx, [body.accountId]);
    const account = accounts.get(body.accountId);
    if (account === undefined) throw validationError("That account does not exist.", { accountId: body.accountId });
    assertCanSpend(account, BigInt(body.amountKobo));

    const expenseId = id();
    const createdAt = now();
    counted(ctx);
    const expense = await ctx.tx.expense.create({
      data: {
        id: expenseId,
        categoryId: body.categoryId,
        channel: body.channel,
        description: body.description.trim(),
        amountKobo: BigInt(body.amountKobo),
        expenseDate: occurredAt,
        createdAt,
        updatedAt: createdAt,
      },
    });
    counted(ctx);
    const ledger = createLedgerEntry(body, expenseId, occurredAt);
    await ctx.tx.accountLedgerEntry.create({ data: ledger });

    const after = expenseDto(expense, category, account);
    await insertAuditLog(ctx, "Expense", {
      actorId: actor.id,
      action: amendedFromExpenseId === null ? "EXPENSE_CREATED" : "EXPENSE_CREATED_BY_AMENDMENT",
      entityId: expenseId,
      afterData: after as Prisma.InputJsonValue,
      metadata:
        amendedFromExpenseId === null
          ? {}
          : ({ amendedFromExpenseId } as Prisma.InputJsonValue),
    });
    return { expense, ledger, category, account, after };
  }

  async function voidInTransaction(
    ctx: TxContext,
    expenseId: string,
    reason: string,
    actor: Actor,
    amendedToExpenseId: string | null = null,
  ) {
    const expense = await lockExpense(ctx, expenseId);
    if (expense.voidedAt !== null) {
      throw businessRuleError("This expense has already been voided.", { expenseId });
    }
    if (expense.loanRepaymentId !== null) {
      throw businessRuleError("Reverse the loan repayment instead of voiding its interest expense.", { expenseId });
    }

    counted(ctx);
    const original = await ctx.tx.accountLedgerEntry.findFirst({
      where: { expenseId, reversesEntryId: null },
      orderBy: { id: "asc" },
    });
    if (original === null) {
      throw businessRuleError("The expense's original account entry is missing.", { expenseId });
    }
    const accounts = await lockAccounts(ctx, [original.accountId]);
    const account = accounts.get(original.accountId);
    if (account === undefined) throw validationError("The expense account no longer exists.", { accountId: original.accountId });
    const existing = await loadAccountEntries(ctx, [original.accountId]);
    let reversal: AccountLedgerEntry | undefined;
    try {
      reversal = buildAccountReversals(
        [original],
        existing,
        [domainAccount(account)],
        now(),
        id,
        reason.trim(),
      )[0];
    } catch (error) {
      if (error instanceof RangeError) throw businessRuleError(error.message, { accountId: account.id });
      throw error;
    }
    if (reversal === undefined) throw new Error("Expense reversal was not created.");

    counted(ctx);
    await ctx.tx.accountLedgerEntry.create({ data: reversal });
    const voidedAt = now();
    counted(ctx);
    const updated = await ctx.tx.expense.update({
      where: { id: expenseId },
      data: { voidedAt, voidReason: reason.trim(), updatedAt: voidedAt },
    });
    const before = {
      id: expense.id,
      categoryId: expense.categoryId,
      channel: expense.channel,
      description: expense.description,
      amountKobo: expense.amountKobo.toString(),
      expenseDate: expense.expenseDate.toISOString(),
      voidedAt: null,
    };
    const after = { ...before, voidedAt: voidedAt.toISOString(), voidReason: reason.trim() };
    await insertAuditLog(ctx, "Expense", {
      actorId: actor.id,
      action: amendedToExpenseId === null ? "EXPENSE_VOIDED" : "EXPENSE_VOIDED_FOR_AMENDMENT",
      entityId: expenseId,
      beforeData: before as Prisma.InputJsonValue,
      afterData: after as Prisma.InputJsonValue,
      metadata: amendedToExpenseId === null ? {} : ({ amendedToExpenseId } as Prisma.InputJsonValue),
    });
    return { expense: updated, reversal, account };
  }

  return {
    async create(body: CreateExpenseBody, actor: Actor, key: string | null): Promise<WriteResponse> {
      return runner.runWrite(createRoute, {}, async (ctx) =>
        runner.withIdempotency(
          ctx,
          { actorId: actor.id, route: createRoute, key, requestHash: hashRequestBody(body) },
          async () => {
            const created = await createInTransaction(ctx, body, actor);
            return { status: 201, body: created.after };
          },
        ),
      );
    },

    async void(expenseId: string, reason: string, actor: Actor, key: string | null): Promise<WriteResponse> {
      const route = voidRoute(expenseId);
      return runner.runWrite(route, { expenseId }, async (ctx) =>
        runner.withIdempotency(
          ctx,
          { actorId: actor.id, route, key, requestHash: hashRequestBody({ reason }) },
          async () => {
            const result = await voidInTransaction(ctx, expenseId, reason, actor);
            return {
              status: 200,
              body: {
                id: result.expense.id,
                voidedAt: result.expense.voidedAt?.toISOString() ?? null,
                voidReason: result.expense.voidReason,
                reversalEntryId: result.reversal.id,
              },
            };
          },
        ),
      );
    },

    async amend(
      expenseId: string,
      body: CreateExpenseBody,
      actor: Actor,
      key: string | null,
    ): Promise<WriteResponse> {
      const route = amendRoute(expenseId);
      return runner.runWrite(route, { expenseId }, async (ctx) =>
        runner.withIdempotency(
          ctx,
          { actorId: actor.id, route, key, requestHash: hashRequestBody(body) },
          async () => {
            const originalExpense = await lockExpense(ctx, expenseId);
            if (originalExpense.voidedAt !== null) {
              throw businessRuleError("This expense has already been voided.", { expenseId });
            }
            if (originalExpense.loanRepaymentId !== null) {
              throw businessRuleError(
                "Reverse the loan repayment instead of amending its interest expense.",
                { expenseId },
              );
            }
            counted(ctx);
            const originalEntry = await ctx.tx.accountLedgerEntry.findFirst({
              where: { expenseId, reversesEntryId: null },
              orderBy: { id: "asc" },
            });
            if (originalEntry === null) {
              throw businessRuleError("The expense's original account entry is missing.", { expenseId });
            }
            const category = await lockCategory(ctx, body.categoryId);
            if (category.code === "LOAN_INTEREST") {
              throw businessRuleError("LOAN_INTEREST is reserved for interest created by a loan repayment.");
            }
            const lockedAccounts = await lockAccounts(ctx, [originalEntry.accountId, body.accountId]);
            const newAccount = lockedAccounts.get(body.accountId);
            if (newAccount === undefined) {
              throw validationError("That account does not exist.", { accountId: body.accountId });
            }
            const availableBalance =
              newAccount.balanceKobo +
              (originalEntry.accountId === body.accountId ? -originalEntry.amountKobo : 0n);
            assertCanSpend(newAccount, BigInt(body.amountKobo), availableBalance);
            const voided = await voidInTransaction(ctx, expenseId, "Amended and recreated.", actor);
            const created = await createInTransaction(ctx, body, actor, expenseId);
            return {
              status: 200,
              body: { expense: created.after, voidedExpenseId: voided.expense.id },
            };
          },
        ),
      );
    },

    list: (query: ListExpensesQuery) => listExpenses(prisma, query, now(), maxDateRangeDays),
    summary: (query: ExpenseSummaryQuery) => summarizeExpenses(prisma, query, now(), maxDateRangeDays),
  };
}
