import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getLagosBusinessDate } from "@fabtyna/shared";
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

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

function isoNowMinusMinutes(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

async function postLoan(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return call(h.app, "POST", "/loans", body, headers);
}

describe("loans API", () => {
  it("creates a loan, raises account balance and writes disbursement + charge entries", async () => {
    const account = await seedAccount(h.pg, { type: "BANK" });
    const response = await postLoan({
      lenderName: `Lender ${newId("loan")}`,
      principalKobo: "100000",
      agreedInterestKobo: "5000",
      disbursedAt: isoNowMinusMinutes(5),
      dueDate: getLagosBusinessDate(new Date(Date.now() + 7 * 86_400_000)),
      note: "Supplier bridge loan",
      accountId: account.id,
    });
    expect(response.status).toBe(201);
    const loanId = response.body.id as string;
    expect(await accountBalanceOf(h.pg, account.id)).toBe(100_000n);
    const ledger = await h.pg.query(
      `SELECT type::text AS type, "amountKobo"::text AS amount
         FROM loan_ledger_entries
        WHERE "loanId" = $1
        ORDER BY type ASC`,
      [loanId],
    );
    expect(ledger.rows).toEqual([
      { type: "CHARGE", amount: "5000" },
      { type: "DISBURSEMENT", amount: "100000" },
    ]);
    const accountRows = await h.pg.query(
      `SELECT type::text AS type, "amountKobo"::text AS amount, "loanId"
         FROM account_ledger_entries
        WHERE "loanId" = $1`,
      [loanId],
    );
    expect(accountRows.rows).toEqual([{ type: "LOAN_DISBURSEMENT", amount: "100000", loanId }]);
  });

  it("adds a charge and increases outstanding", async () => {
    const account = await seedAccount(h.pg);
    const created = await postLoan({
      lenderName: `Charge lender ${newId("loan")}`,
      principalKobo: "50000",
      agreedInterestKobo: "0",
      disbursedAt: isoNowMinusMinutes(4),
      dueDate: null,
      note: null,
      accountId: account.id,
    });
    expect(created.status).toBe(201);
    const loanId = created.body.id as string;
    const charge = await call(h.app, "POST", `/loans/${loanId}/charges`, {
      amountKobo: "2500",
      reason: "Late fee",
      occurredAt: isoNowMinusMinutes(3),
    });
    expect(charge.status).toBe(201);
    const list = await call(h.app, "GET", `/loans?q=${encodeURIComponent("Charge lender")}`);
    const item = list.body.items.find((row: any) => row.id === loanId);
    expect(item.chargesKobo).toBe("2500");
    expect(item.outstandingKobo).toBe("52500");
  });

  it("records repayment with interest as one account outflow and one LOAN_INTEREST expense only", async () => {
    const account = await seedAccount(h.pg, { type: "BANK" });
    await fundAccount(h.pg, account.id, 200_000n);
    const created = await postLoan({
      lenderName: `Repay lender ${newId("loan")}`,
      principalKobo: "90000",
      agreedInterestKobo: "10000",
      disbursedAt: isoNowMinusMinutes(8),
      dueDate: null,
      note: null,
      accountId: account.id,
    });
    const loanId = created.body.id as string;
    const repayment = await call(h.app, "POST", `/loans/${loanId}/repayments`, {
      amountKobo: "25000",
      interestPortionKobo: "4000",
      paidAt: isoNowMinusMinutes(2),
      note: "Part repayment",
      accountId: account.id,
    });
    expect(repayment.status).toBe(201);
    const repaymentId = repayment.body.id as string;

    const accountEntries = await h.pg.query(
      `SELECT type::text AS type, "amountKobo"::text AS amount, "expenseId"
         FROM account_ledger_entries
        WHERE "loanRepaymentId" = $1
        ORDER BY "occurredAt" ASC, id ASC`,
      [repaymentId],
    );
    expect(accountEntries.rows).toHaveLength(1);
    expect(accountEntries.rows[0]).toMatchObject({
      type: "LOAN_REPAYMENT",
      amount: "-25000",
      expenseId: null,
    });
    const expenses = await h.pg.query(
      `SELECT ec.code, e."amountKobo"::text AS amount
         FROM expenses e
         JOIN expense_categories ec ON ec.id = e."categoryId"
        WHERE e."loanRepaymentId" = $1`,
      [repaymentId],
    );
    expect(expenses.rows).toEqual([{ code: "LOAN_INTEREST", amount: "4000" }]);
  });

  it("records principal-only repayment without creating an expense", async () => {
    const account = await seedAccount(h.pg);
    await fundAccount(h.pg, account.id, 80_000n);
    const created = await postLoan({
      lenderName: `Principal only ${newId("loan")}`,
      principalKobo: "40000",
      agreedInterestKobo: "0",
      disbursedAt: isoNowMinusMinutes(7),
      dueDate: null,
      note: null,
      accountId: account.id,
    });
    const loanId = created.body.id as string;
    const repayment = await call(h.app, "POST", `/loans/${loanId}/repayments`, {
      amountKobo: "10000",
      interestPortionKobo: "0",
      paidAt: isoNowMinusMinutes(1),
      note: null,
      accountId: account.id,
    });
    expect(repayment.status).toBe(201);
    const repaymentId = repayment.body.id as string;
    const expenses = await h.pg.query(`SELECT count(*)::int AS n FROM expenses WHERE "loanRepaymentId" = $1`, [
      repaymentId,
    ]);
    expect(expenses.rows[0].n).toBe(0);
  });

  it("rejects overpay with validation including outstanding amount", async () => {
    const account = await seedAccount(h.pg);
    await fundAccount(h.pg, account.id, 200_000n);
    const created = await postLoan({
      lenderName: `Overpay ${newId("loan")}`,
      principalKobo: "20000",
      agreedInterestKobo: "0",
      disbursedAt: isoNowMinusMinutes(6),
      dueDate: null,
      note: null,
      accountId: account.id,
    });
    const loanId = created.body.id as string;
    const repayment = await call(h.app, "POST", `/loans/${loanId}/repayments`, {
      amountKobo: "20001",
      interestPortionKobo: "0",
      paidAt: isoNowMinusMinutes(1),
      note: null,
      accountId: account.id,
    });
    expect(repayment.status).toBe(400);
    expect(repayment.body.error.message).toContain("outstanding balance of 20000");
  });

  it("rejects repayment from an account that cannot afford it with friendly message and no writes", async () => {
    const account = await seedAccount(h.pg);
    const created = await postLoan({
      lenderName: `Overspend ${newId("loan")}`,
      principalKobo: "50000",
      agreedInterestKobo: "0",
      disbursedAt: isoNowMinusMinutes(4),
      dueDate: null,
      note: null,
      accountId: account.id,
    });
    const loanId = created.body.id as string;
    const beforeRepayments = await h.pg.query(
      `SELECT count(*)::int AS n FROM loan_repayments WHERE "loanId" = $1`,
      [loanId],
    );
    const repayment = await call(h.app, "POST", `/loans/${loanId}/repayments`, {
      amountKobo: "50001",
      interestPortionKobo: "0",
      paidAt: isoNowMinusMinutes(1),
      note: null,
      accountId: account.id,
    });
    expect(repayment.status).toBe(409);
    expect(repayment.body.error.message).toContain(account.name);
    expect(repayment.body.error.message).toContain("record income or reconcile first");
    const afterRepayments = await h.pg.query(
      `SELECT count(*)::int AS n FROM loan_repayments WHERE "loanId" = $1`,
      [loanId],
    );
    expect(afterRepayments.rows[0].n).toBe(beforeRepayments.rows[0].n);
  });

  it("allows exactly one of two simultaneous repayments that exceed outstanding", async () => {
    const account = await seedAccount(h.pg);
    await fundAccount(h.pg, account.id, 200_000n);
    const created = await postLoan({
      lenderName: `Concurrent repay ${newId("loan")}`,
      principalKobo: "10000",
      agreedInterestKobo: "0",
      disbursedAt: isoNowMinusMinutes(5),
      dueDate: null,
      note: null,
      accountId: account.id,
    });
    const loanId = created.body.id as string;
    const responses = await Promise.all(
      [0, 1].map(() =>
        call(h.app, "POST", `/loans/${loanId}/repayments`, {
          amountKobo: "7000",
          interestPortionKobo: "0",
          paidAt: isoNowMinusMinutes(1),
          note: "Concurrent",
          accountId: account.id,
        }),
      ),
    );
    expect(responses.filter((res) => res.status === 201)).toHaveLength(1);
    expect(responses.filter((res) => res.status === 400)).toHaveLength(1);
  });

  it("lists derived statuses and filters, and returns loan detail shape", async () => {
    const account = await seedAccount(h.pg);
    await fundAccount(h.pg, account.id, 500_000n);
    const today = getLagosBusinessDate(new Date());
    const overdueDate = new Date(`${today}T00:00:00.000Z`);
    overdueDate.setUTCDate(overdueDate.getUTCDate() - 1);
    const overdue = await postLoan({
      lenderName: `Status overdue ${newId("loan")}`,
      principalKobo: "30000",
      agreedInterestKobo: "0",
      disbursedAt: isoNowMinusMinutes(20),
      dueDate: overdueDate.toISOString().slice(0, 10),
      note: null,
      accountId: account.id,
    });
    const paid = await postLoan({
      lenderName: `Status paid ${newId("loan")}`,
      principalKobo: "15000",
      agreedInterestKobo: "0",
      disbursedAt: isoNowMinusMinutes(18),
      dueDate: null,
      note: null,
      accountId: account.id,
    });
    const paidId = paid.body.id as string;
    const paidRepayment = await call(h.app, "POST", `/loans/${paidId}/repayments`, {
      amountKobo: "15000",
      interestPortionKobo: "0",
      paidAt: isoNowMinusMinutes(10),
      note: null,
      accountId: account.id,
    });
    expect(paidRepayment.status).toBe(201);
    const active = await postLoan({
      lenderName: `Status active ${newId("loan")}`,
      principalKobo: "22000",
      agreedInterestKobo: "1000",
      disbursedAt: isoNowMinusMinutes(16),
      dueDate: null,
      note: null,
      accountId: account.id,
    });

    const defaultList = await call(h.app, "GET", "/loans");
    expect(defaultList.status).toBe(200);
    expect(defaultList.body.items.every((item: any) => item.status !== "PAID")).toBe(true);

    const overdueOnly = await call(h.app, "GET", "/loans?status=OVERDUE");
    expect(overdueOnly.body.items.some((item: any) => item.id === overdue.body.id)).toBe(true);
    const paidOnly = await call(h.app, "GET", "/loans?status=PAID");
    expect(paidOnly.body.items.some((item: any) => item.id === paidId)).toBe(true);
    const byName = await call(h.app, "GET", `/loans?q=${encodeURIComponent("status active")}`);
    expect(byName.body.items.some((item: any) => item.id === active.body.id)).toBe(true);
    const dueBefore = await call(h.app, "GET", `/loans?dueBefore=${overdueDate.toISOString().slice(0, 10)}`);
    expect(dueBefore.body.items.some((item: any) => item.id === overdue.body.id)).toBe(true);

    const detail = await call(h.app, "GET", `/loans/${paidId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.summary.id).toBe(paidId);
    expect(Array.isArray(detail.body.ledgerEntries)).toBe(true);
    expect(Array.isArray(detail.body.repayments)).toBe(true);
    expect(Array.isArray(detail.body.charges)).toBe(true);
  });

  it("replays idempotent loan create without creating a duplicate", async () => {
    const account = await seedAccount(h.pg);
    const key = newId("loan-idem");
    const body = {
      lenderName: `Idem lender ${newId("loan")}`,
      principalKobo: "12000",
      agreedInterestKobo: "0",
      disbursedAt: isoNowMinusMinutes(2),
      dueDate: null,
      note: null,
      accountId: account.id,
    };
    const first = await postLoan(body, { "idempotency-key": key });
    const second = await postLoan(body, { "idempotency-key": key });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.body.id).toBe(first.body.id);
    const count = await h.pg.query(`SELECT count(*)::int AS n FROM loans WHERE id = $1`, [first.body.id]);
    expect(count.rows[0].n).toBe(1);
  });
});
