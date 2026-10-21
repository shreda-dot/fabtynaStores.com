import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "../../../generated/prisma/client.js";
import {
  addLoanCharge,
  assertAccountWillRemainNonnegative,
  createLoan,
  getLagosBusinessDate,
  recordLoanRepayment,
  type Account,
  type AccountLedgerEntry,
  type Loan,
  type LoanLedgerEntry,
} from "@fabtyna/shared";
import type { Actor } from "../../auth/actor.js";
import { AppError, businessRuleError, validationError } from "../../lib/errors.js";
import { hashRequestBody } from "../../lib/idempotency.js";
import { lockAccounts, type LockedAccount } from "../../lib/locks.js";
import { createWriteRunner, insertAuditLog, counted, type TxContext, type WriteResponse } from "../../lib/tx.js";
import type { TxTimeouts } from "../../lib/tx-options.js";
import { assertNotInFuture } from "../sales/sales.validation.js";
import { getLoanDetail, listLoans } from "./loans.queries.js";
import type {
  AddLoanChargeDto,
  CreateLoanDto,
  ListLoansQuery,
  RecordLoanRepaymentDto,
} from "./loans.schemas.js";

const newId = (): string => randomUUID();

const createRoute = "POST /loans";
const chargeRoute = (loanId: string): string => `POST /loans/${loanId}/charges`;
const repaymentRoute = (loanId: string): string => `POST /loans/${loanId}/repayments`;

export type LoanResponse = WriteResponse;
export type LoansService = ReturnType<typeof createLoansService>;

export interface LoansServiceOptions {
  prisma: PrismaClient;
  now?: () => Date;
  log?: (entry: Record<string, unknown>) => void;
  txTimeouts?: TxTimeouts;
}

function asDomainAccount(account: LockedAccount): Account {
  const epoch = new Date(0);
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    isActive: account.isActive,
    deactivatedAt: null,
    note: null,
    createdAt: epoch,
    updatedAt: epoch,
  };
}

function accountOrThrow(locked: Map<string, LockedAccount>, accountId: string, message: string): LockedAccount {
  const account = locked.get(accountId);
  if (account === undefined) {
    throw new AppError(404, "NOT_FOUND", message, { accountId });
  }
  return account;
}

function assertAccountActive(account: LockedAccount, mode: "receive" | "pay"): void {
  if (!account.isActive) {
    const action = mode === "receive" ? "receive" : "pay out";
    throw businessRuleError(`Account '${account.name}' is deactivated and cannot ${action} money.`, {
      accountId: account.id,
    });
  }
}

function assertCanSpend(account: LockedAccount, amountKobo: bigint): void {
  try {
    assertAccountWillRemainNonnegative(account, account.balanceKobo, -amountKobo, "spend");
  } catch (error) {
    if (error instanceof RangeError) {
      throw businessRuleError(error.message, {
        accountId: account.id,
        accountName: account.name,
        balanceKobo: account.balanceKobo.toString(),
        amountKobo: amountKobo.toString(),
      });
    }
    throw error;
  }
}

function mapDomainError<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof RangeError) {
      throw validationError(error.message);
    }
    throw error;
  }
}

async function lockLoan(ctx: TxContext, loanId: string): Promise<Loan> {
  counted(ctx);
  const rows = await ctx.tx.$queryRaw<Loan[]>`
    SELECT id, "lenderName", "principalKobo", "agreedInterestKobo", "disbursedAt", "dueDate", note, "createdAt"
      FROM loans
     WHERE id = ${loanId}
       FOR UPDATE`;
  const loan = rows[0];
  if (loan === undefined) {
    throw new AppError(404, "NOT_FOUND", "Loan not found.", { id: loanId });
  }
  return loan;
}

async function loadLoanEntries(ctx: TxContext, loanId: string): Promise<LoanLedgerEntry[]> {
  counted(ctx);
  return ctx.tx.loanLedgerEntry.findMany({
    where: { loanId },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  });
}

async function createLoanEntries(ctx: TxContext, entries: readonly LoanLedgerEntry[]): Promise<void> {
  if (entries.length === 0) return;
  counted(ctx);
  await ctx.tx.loanLedgerEntry.createMany({ data: entries.map((entry) => ({ ...entry })) });
}

async function createAccountEntries(ctx: TxContext, entries: readonly AccountLedgerEntry[]): Promise<void> {
  if (entries.length === 0) return;
  counted(ctx);
  await ctx.tx.accountLedgerEntry.createMany({ data: entries.map((entry) => ({ ...entry })) });
}

async function resolveLoanInterestCategoryId(ctx: TxContext): Promise<string> {
  counted(ctx);
  const category = await ctx.tx.expenseCategory.findUnique({
    where: { code: "LOAN_INTEREST" },
    select: { id: true, isActive: true },
  });
  if (category === null || !category.isActive) {
    throw new AppError(
      500,
      "INTERNAL",
      "System expense category LOAN_INTEREST is missing or inactive.",
      { categoryCode: "LOAN_INTEREST" },
    );
  }
  return category.id;
}

export function createLoansService(options: LoansServiceOptions) {
  const { prisma } = options;
  const now = options.now ?? (() => new Date());
  const { runWrite, withIdempotency } = createWriteRunner({
    prisma,
    now,
    log: options.log,
    txTimeouts: options.txTimeouts,
  });

  return {
    async createLoan(body: CreateLoanDto, actor: Actor, key: string | null): Promise<LoanResponse> {
      const disbursedAt = new Date(body.disbursedAt);
      assertNotInFuture(disbursedAt, now(), "disbursedAt", "Disbursement date");
      return runWrite(createRoute, {}, async (ctx) =>
        withIdempotency(
          ctx,
          { actorId: actor.id, route: createRoute, key, requestHash: hashRequestBody(body) },
          async () => {
            const accountId = body.accountId?.trim() ?? "";
            if (accountId === "") {
              throw validationError("Select the account that received the loan disbursement.", { field: "accountId" });
            }
            const lockedAccounts = await lockAccounts(ctx, [accountId]);
            const account = accountOrThrow(lockedAccounts, accountId, "Disbursement account not found.");
            assertAccountActive(account, "receive");
            const built = mapDomainError(() =>
              createLoan(
                {
                  lenderName: body.lenderName,
                  principalKobo: BigInt(body.principalKobo),
                  agreedInterestKobo: BigInt(body.agreedInterestKobo),
                  disbursedAt,
                  dueDate: body.dueDate,
                  note: body.note ?? null,
                  accountId,
                },
                newId,
              ),
            );
            counted(ctx);
            await ctx.tx.loan.create({ data: { ...built.loan } });
            await createLoanEntries(ctx, built.ledgerEntries);
            await createAccountEntries(ctx, [built.accountLedgerEntry]);
            await insertAuditLog(ctx, "loan", {
              actorId: actor.id,
              action: "LOAN_CREATED",
              entityId: built.loan.id,
              beforeData: undefined,
              afterData: {
                loanId: built.loan.id,
                principalKobo: built.loan.principalKobo.toString(),
                agreedInterestKobo: built.loan.agreedInterestKobo.toString(),
                accountId: built.accountLedgerEntry.accountId,
              } as Prisma.InputJsonValue,
              metadata: { actorEmail: actor.email } as Prisma.InputJsonValue,
            });
            return {
              status: 201,
              body: {
                id: built.loan.id,
                lenderName: built.loan.lenderName,
                principalKobo: built.loan.principalKobo.toString(),
                agreedInterestKobo: built.loan.agreedInterestKobo.toString(),
                disbursedAt: built.loan.disbursedAt.toISOString(),
                dueDate: built.loan.dueDate,
                note: built.loan.note,
              },
            };
          },
        ),
      );
    },

    async addCharge(loanId: string, body: AddLoanChargeDto, actor: Actor, key: string | null): Promise<LoanResponse> {
      const occurredAt = new Date(body.occurredAt);
      assertNotInFuture(occurredAt, now(), "occurredAt", "Charge date");
      return runWrite(chargeRoute(loanId), { loanId }, async (ctx) =>
        withIdempotency(
          ctx,
          { actorId: actor.id, route: chargeRoute(loanId), key, requestHash: hashRequestBody(body) },
          async () => {
            const loan = await lockLoan(ctx, loanId);
            const charge = mapDomainError(() =>
              addLoanCharge(
                {
                  loanId,
                  amountKobo: BigInt(body.amountKobo),
                  reason: body.reason,
                  occurredAt,
                },
                [loan],
                newId,
              ),
            );
            await createLoanEntries(ctx, [charge]);
            await insertAuditLog(ctx, "loan", {
              actorId: actor.id,
              action: "LOAN_CHARGE_RECORDED",
              entityId: loanId,
              beforeData: undefined,
              afterData: {
                loanId,
                chargeId: charge.id,
                amountKobo: charge.amountKobo.toString(),
                reason: charge.note,
              } as Prisma.InputJsonValue,
              metadata: { actorEmail: actor.email } as Prisma.InputJsonValue,
            });
            return {
              status: 201,
              body: {
                id: charge.id,
                loanId,
                type: charge.type,
                amountKobo: charge.amountKobo.toString(),
                note: charge.note,
                occurredAt: charge.occurredAt.toISOString(),
              },
            };
          },
        ),
      );
    },

    async recordRepayment(
      loanId: string,
      body: RecordLoanRepaymentDto,
      actor: Actor,
      key: string | null,
    ): Promise<LoanResponse> {
      const paidAt = new Date(body.paidAt);
      assertNotInFuture(paidAt, now(), "paidAt", "Repayment date");
      return runWrite(repaymentRoute(loanId), { loanId }, async (ctx) =>
        withIdempotency(
          ctx,
          { actorId: actor.id, route: repaymentRoute(loanId), key, requestHash: hashRequestBody(body) },
          async () => {
            const loan = await lockLoan(ctx, loanId);
            const accountId = body.accountId?.trim() ?? "";
            if (accountId === "") {
              throw validationError("Select the account used for this repayment.", { field: "accountId" });
            }
            const lockedAccounts = await lockAccounts(ctx, [accountId]);
            const account = accountOrThrow(lockedAccounts, accountId, "Repayment account not found.");
            assertAccountActive(account, "pay");
            const amount = BigInt(body.amountKobo);
            assertCanSpend(account, amount);
            const existingEntries = await loadLoanEntries(ctx, loanId);
            const built = mapDomainError(() =>
              recordLoanRepayment(
                {
                  loanId,
                  amountKobo: amount,
                  interestPortionKobo: BigInt(body.interestPortionKobo),
                  paidAt,
                  note: body.note ?? null,
                  accountId,
                },
                [loan],
                existingEntries,
                newId,
              ),
            );

            counted(ctx);
            await ctx.tx.loanRepayment.create({ data: { ...built.repayment } });
            await createLoanEntries(ctx, [built.ledgerEntry]);
            await createAccountEntries(ctx, [built.accountLedgerEntry]);
            if (built.expense !== null) {
              const categoryId = await resolveLoanInterestCategoryId(ctx);
              counted(ctx);
              await ctx.tx.expense.create({
                data: {
                  id: built.expense.id,
                  categoryId,
                  channel: built.expense.channel,
                  description: built.expense.description,
                  amountKobo: built.expense.amountKobo,
                  expenseDate: built.expense.expenseDate,
                  loanRepaymentId: built.expense.loanRepaymentId,
                  voidedAt: null,
                  voidReason: null,
                },
              });
            }
            await insertAuditLog(ctx, "loan", {
              actorId: actor.id,
              action: "LOAN_REPAYMENT_RECORDED",
              entityId: loanId,
              beforeData: undefined,
              afterData: {
                loanId,
                repaymentId: built.repayment.id,
                amountKobo: built.repayment.amountKobo.toString(),
                interestPortionKobo: built.repayment.interestPortionKobo.toString(),
                accountId,
              } as Prisma.InputJsonValue,
              metadata: { actorEmail: actor.email } as Prisma.InputJsonValue,
            });
            return {
              status: 201,
              body: {
                id: built.repayment.id,
                loanId,
                amountKobo: built.repayment.amountKobo.toString(),
                interestPortionKobo: built.repayment.interestPortionKobo.toString(),
                paidAt: built.repayment.paidAt.toISOString(),
                note: built.repayment.note,
                accountId: built.accountLedgerEntry.accountId,
              },
            };
          },
        ),
      );
    },

    async listLoans(query: ListLoansQuery) {
      return listLoans(prisma, query, getLagosBusinessDate(now()));
    },

    async getLoan(loanId: string) {
      return getLoanDetail(prisma, loanId, getLagosBusinessDate(now()));
    },
  };
}
