import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getLagosBusinessDate } from "@fabtyna/shared";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  accountBalanceOf,
  call,
  createHarness,
  fundAccount,
  newId,
  seedAccount,
  type Harness,
} from "./sales-fixtures.js";

let h!: Harness;
let statements = 0;
// Shared by the first three tests, which run in order.
let state!: {
  accountId: string;
  loanId: string;
  firstId: string;
  linkedExpenseId: string;
  day: string;
  summaryUrl: string;
  reportUrl: string;
  before: { summary: any; retail: any; report: any; position: any };
};

const countedModels = new Set([
  "loan",
  "loanLedgerEntry",
  "loanRepayment",
  "accountLedgerEntry",
  "expense",
  "expenseCategory",
]);

function countStatements(prisma: PrismaClient): PrismaClient {
  return new Proxy(prisma, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (countedModels.has(String(property)) && typeof value === "object" && value !== null) {
        return new Proxy(value, {
          get(delegate, operation) {
            const member = Reflect.get(delegate, operation, delegate);
            return typeof member === "function"
              ? (...args: unknown[]) => {
                  statements += 1;
                  return member.apply(delegate, args);
                }
              : member;
          },
        });
      }
      if (property === "$queryRaw" && typeof value === "function") {
        return (...args: unknown[]) => {
          statements += 1;
          return value.apply(target, args);
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

beforeAll(async () => {
  h = await createHarness({ wrapPrisma: countStatements });
});

afterAll(async () => {
  await h.close();
});

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

async function counted<T>(action: () => Promise<T>): Promise<{ result: T; statements: number }> {
  statements = 0;
  const result = await action();
  return { result, statements };
}

describe("LOAN_INTEREST is a reporting expense, never a second outflow", () => {
  it("shows up in expenses, summary, loan detail and profit while cash falls only once", async () => {
    const account = await seedAccount(h.pg, { type: "BANK" });
    await fundAccount(h.pg, account.id, 200_000n);
    const lender = `ZZ Interest lender ${newId("l")}`;
    const created = await call(h.app, "POST", "/loans", {
      lenderName: lender,
      principalKobo: "90000",
      agreedInterestKobo: "10000",
      disbursedAt: minutesAgo(8),
      dueDate: null,
      note: null,
      accountId: account.id,
    });
    expect(created.status).toBe(201);
    const loanId = created.body.id as string;
    // 200,000 funded + 90,000 borrowed.
    expect(await accountBalanceOf(h.pg, account.id)).toBe(290_000n);

    const paidAt = minutesAgo(2);
    const day = getLagosBusinessDate(new Date(paidAt));
    const categories = await call(h.app, "GET", "/expense-categories?includeInactive=true");
    const interestCategory = (categories.body as unknown as Array<{ id: string; code: string | null }>).find(
      (category) => category.code === "LOAN_INTEREST",
    );
    expect(interestCategory).toBeDefined();

    const summaryUrl = `/expenses/summary?from=${day}&to=${day}`;
    const retailSummaryUrl = `${summaryUrl}&channel=RETAIL`;
    const reportUrl = `/reports/sales-summary?from=${day}&to=${day}`;
    const before = {
      summary: (await call(h.app, "GET", summaryUrl)).body,
      retail: (await call(h.app, "GET", retailSummaryUrl)).body,
      report: (await call(h.app, "GET", reportUrl)).body,
      position: (await call(h.app, "GET", "/reports/financial-position?scenario=EXPECTED")).body,
    };
    const interestCategoryBefore = BigInt(
      before.summary.byCategory.find((row: { id: string }) => row.id === interestCategory!.id)?.totalKobo ?? "0",
    );

    // Repayment 1: 25,000 out of the account, 4,000 of it is interest.
    const first = await call(h.app, "POST", `/loans/${loanId}/repayments`, {
      amountKobo: "25000",
      interestPortionKobo: "4000",
      paidAt,
      note: null,
      accountId: account.id,
    });
    expect(first.status).toBe(201);
    const firstId = first.body.id as string;
    // 290,000 - 25,000 = 265,000 (NOT 261,000: the interest is not a second outflow).
    expect(await accountBalanceOf(h.pg, account.id)).toBe(265_000n);

    // GET /expenses: the interest row is listed, system-managed, without account fields.
    const listed = await call(h.app, "GET", `/expenses?from=${day}&to=${day}&q=${encodeURIComponent(lender)}`);
    expect(listed.status).toBe(200);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0]).toMatchObject({
      amountKobo: "4000",
      channel: "BOTH",
      accountId: null,
      accountName: null,
      systemManaged: true,
      loanRepaymentId: firstId,
      categoryCode: "LOAN_INTEREST",
      voided: false,
    });
    const linkedExpenseId = listed.body.items[0].id as string;

    // The account filter still means "money that moved in this account", so interest is not there.
    const byAccount = await call(h.app, "GET", `/expenses?from=${day}&to=${day}&accountId=${account.id}`);
    expect(byAccount.body.items.some((item: { id: string }) => item.id === linkedExpenseId)).toBe(false);

    // GET /expenses/summary: +4,000 and +1 row; the category breakdown includes it.
    const after = (await call(h.app, "GET", summaryUrl)).body;
    expect(BigInt(after.totalKobo) - BigInt(before.summary.totalKobo)).toBe(4000n);
    expect(after.count - before.summary.count).toBe(1);
    const interestCategoryAfter = BigInt(
      after.byCategory.find((row: { id: string }) => row.id === interestCategory!.id)?.totalKobo ?? "0",
    );
    expect(interestCategoryAfter - interestCategoryBefore).toBe(4000n);
    // BOTH split is unchanged: 4,000 -> 2,000 retail.
    const retailAfter = (await call(h.app, "GET", retailSummaryUrl)).body;
    expect(BigInt(retailAfter.totalKobo) - BigInt(before.retail.totalKobo)).toBe(2000n);

    state = { accountId: account.id, loanId, firstId, linkedExpenseId, day, summaryUrl, reportUrl, before };
  });

  it("returns the linked expense on loan detail with fixed statement counts", async () => {
    const { accountId, loanId, firstId, linkedExpenseId, day, summaryUrl } = state;
    const account = { id: accountId };
    // Repayment 2 has no interest: it must not create an expense and has no linked expense.
    const second = await call(h.app, "POST", `/loans/${loanId}/repayments`, {
      amountKobo: "10000",
      interestPortionKobo: "0",
      paidAt: minutesAgo(1),
      note: null,
      accountId: account.id,
    });
    expect(second.status).toBe(201);
    // 265,000 - 10,000 = 255,000.
    expect(await accountBalanceOf(h.pg, account.id)).toBe(255_000n);

    // Loan detail: additive linkedExpense per repayment.
    const detail = await counted(() => call(h.app, "GET", `/loans/${loanId}`));
    expect(detail.result.status).toBe(200);
    const repayments = detail.result.body.repayments as Array<Record<string, unknown>>;
    expect(repayments).toHaveLength(2);
    expect(repayments[0]).toMatchObject({
      id: firstId,
      interestPortionKobo: "4000",
      linkedExpense: { id: linkedExpenseId, amountKobo: "4000", categoryCode: "LOAN_INTEREST" },
    });
    expect(repayments[1]).toMatchObject({ interestPortionKobo: "0", linkedExpense: null });
    // Fixed statement count: loan, ledger, repayments, account entries, linked expenses.
    console.log(`STATEMENTS GET /loans/:id (2 repayments) = ${detail.statements}`);
    expect(detail.statements).toBe(5);

    const listCount = await counted(() => call(h.app, "GET", `/expenses?from=${day}&to=${day}`));
    console.log(`STATEMENTS GET /expenses = ${listCount.statements}`);
    expect(listCount.statements).toBe(1);
    const summaryCount = await counted(() => call(h.app, "GET", summaryUrl));
    console.log(`STATEMENTS GET /expenses/summary = ${summaryCount.statements}`);
    expect(summaryCount.statements).toBe(1);

    // The interest expense cannot be voided or amended on its own.
    const voidTry = await call(h.app, "POST", `/expenses/${linkedExpenseId}/void`, { reason: "try" });
    expect(voidTry.status).toBe(409);
  });

  it("counts interest as profit but never as a second cash outflow in reports", async () => {
    const { accountId, day, reportUrl, before } = state;
    const account = { id: accountId };

    // Sales summary: interest is an expense and lowers net profit by exactly 4,000.
    const report = (await call(h.app, "GET", reportUrl)).body;
    expect(BigInt(report.totals.totalExpensesKobo) - BigInt(before.report.totals.totalExpensesKobo)).toBe(4000n);
    expect(BigInt(report.totals.totalNetProfitKobo) - BigInt(before.report.totals.totalNetProfitKobo)).toBe(-4000n);

    // Dashboard for that day carries the same expense and profit movement.
    const dashboard = await call(h.app, "GET", `/reports/dashboard?date=${day}`);
    expect(dashboard.status).toBe(200);
    expect(BigInt(dashboard.body.metrics.expensesKobo.value)).toBeGreaterThanOrEqual(4000n);

    // Money flow for the account: 35,000 left (25,000 + 10,000), never 39,000.
    const flow = await call(h.app, "GET", `/reports/money-flow?from=${day}&to=${day}&accountId=${account.id}`);
    expect(flow.status).toBe(200);
    expect(flow.body.rows).toHaveLength(1);
    expect(flow.body.rows[0].moneyOutKobo).toBe("35000");
    expect(flow.body.rows[0].closingBalanceKobo).toBe("255000");
    expect(
      flow.body.rows[0].categories.some((category: { key: string }) => category.key === "LOAN_INTEREST"),
    ).toBe(false);

    // Financial position cash fell by 35,000 only.
    const position = (await call(h.app, "GET", "/reports/financial-position?scenario=EXPECTED")).body;
    expect(BigInt(before.position.selected.cashKobo) - BigInt(position.selected.cashKobo)).toBe(35_000n);

  });

  it("keeps voided ordinary expenses out of the list and summary", async () => {
    const account = await seedAccount(h.pg, { type: "CASH" });
    await fundAccount(h.pg, account.id, 50_000n);
    const categories = await call(h.app, "GET", "/expense-categories");
    const other = (categories.body as unknown as Array<{ id: string; code: string | null }>).find(
      (category) => category.code === "OTHER",
    );
    const day = getLagosBusinessDate(new Date());
    const summaryUrl = `/expenses/summary?from=${day}&to=${day}`;
    const before = (await call(h.app, "GET", summaryUrl)).body;
    const description = `ZZ void check ${newId("e")}`;
    const expense = await call(h.app, "POST", "/expenses", {
      categoryId: other!.id,
      channel: "RETAIL",
      description,
      amountKobo: "1234",
      expenseDate: new Date().toISOString(),
      accountId: account.id,
    });
    expect(expense.status).toBe(201);
    const live = (await call(h.app, "GET", summaryUrl)).body;
    expect(BigInt(live.totalKobo) - BigInt(before.totalKobo)).toBe(1234n);
    const voided = await call(h.app, "POST", `/expenses/${expense.body.id}/void`, { reason: "ZZ test" });
    expect(voided.status).toBe(200);
    const afterVoid = (await call(h.app, "GET", summaryUrl)).body;
    expect(afterVoid.totalKobo).toBe(before.totalKobo);
    expect(afterVoid.count).toBe(before.count);
    const list = await call(h.app, "GET", `/expenses?from=${day}&to=${day}&q=${encodeURIComponent(description)}`);
    expect(list.body.items).toHaveLength(0);
    const withVoided = await call(
      h.app,
      "GET",
      `/expenses?from=${day}&to=${day}&q=${encodeURIComponent(description)}&includeVoided=true`,
    );
    expect(withVoided.body.items).toHaveLength(1);
    expect(withVoided.body.items[0]).toMatchObject({ systemManaged: false, voided: true });
    expect(withVoided.body.items[0].accountId).toBe(account.id);
  });
});
