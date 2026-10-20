import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getLagosBusinessDate } from "@fabtyna/shared";
import {
  accountBalanceOf,
  createHarness,
  newId,
  type Harness,
} from "./sales-fixtures.js";

let h!: Harness;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

async function createAccount(name: string) {
  const response = await h.app.inject({
    method: "POST",
    url: "/accounts",
    payload: { name, type: "CASH" },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ id: string; name: string }>();
}

async function createExpenseCategory(name: string) {
  const response = await h.app.inject({
    method: "POST",
    url: "/expense-categories",
    headers: { "idempotency-key": newId("expense-category") },
    payload: { name },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ id: string }>();
}

describe("4A close-out coverage gaps", () => {
  it("summarizes by category and allocates odd BOTH amounts without losing kobo", async () => {
    const account = await createAccount(`Summary ${newId("account")}`);
    const opening = await h.app.inject({
      method: "POST",
      url: `/accounts/${account.id}/opening-balance`,
      payload: { amountKobo: "100000" },
    });
    expect(opening.statusCode).toBe(201);
    const firstCategory = await createExpenseCategory(`Transport ${newId("category")}`);
    const secondCategory = await createExpenseCategory(`Utilities ${newId("category")}`);
    const today = new Date().toISOString();

    for (const expense of [
      { categoryId: firstCategory.id, channel: "BOTH", amountKobo: "90001" },
      { categoryId: secondCategory.id, channel: "RETAIL", amountKobo: "1000" },
    ]) {
      const response = await h.app.inject({
        method: "POST",
        url: "/expenses",
        payload: {
          ...expense,
          description: `Summary test ${newId("expense")}`,
          expenseDate: today,
          accountId: account.id,
        },
      });
      expect(response.statusCode, response.body).toBe(201);
    }

    const summary = await h.app.inject({
      method: "GET",
      url: `/expenses/summary?accountId=${account.id}`,
    });
    expect(summary.statusCode).toBe(200);
    const summaryBody = summary.json<{
      totalKobo: string;
      count: number;
      byCategory: Array<{ id: string; totalKobo: string; count: number }>;
    }>();
    expect(summaryBody.totalKobo).toBe("91001");
    expect(summaryBody.count).toBe(2);
    expect(summaryBody.byCategory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: firstCategory.id, totalKobo: "90001", count: 1 }),
        expect.objectContaining({ id: secondCategory.id, totalKobo: "1000", count: 1 }),
      ]),
    );

    const retail = await h.app.inject({
      method: "GET",
      url: `/expenses/summary?accountId=${account.id}&channel=RETAIL`,
    });
    expect(retail.json<{ totalKobo: string }>().totalKobo).toBe("46000");
    const wholesale = await h.app.inject({
      method: "GET",
      url: `/expenses/summary?accountId=${account.id}&channel=WHOLESALE`,
    });
    expect(wholesale.json<{ totalKobo: string }>().totalKobo).toBe("45001");
  });

  it("keeps search/debt lists unbounded by default but expenses default to today", async () => {
    const today = getLagosBusinessDate(new Date());
    for (const url of [
      "/sales?unpaid=true",
      "/sales?q=missing-gate-record",
      `/sales?customerId=${newId("missing-customer")}`,
      "/purchases?unpaid=true",
      "/purchases?overdue=true",
      "/purchases?q=missing-gate-record",
      `/purchases?supplierId=${newId("missing-supplier")}`,
    ]) {
      const response = await h.app.inject({ method: "GET", url });
      expect(response.statusCode, `${url}: ${response.body}`).toBe(200);
      expect(response.json<{ from: string | null; to: string | null }>()).toMatchObject({
        from: null,
        to: null,
      });
    }
    const expenses = await h.app.inject({ method: "GET", url: "/expenses" });
    expect(expenses.statusCode).toBe(200);
    expect(expenses.json<{ from: string; to: string }>()).toMatchObject({
      from: today,
      to: today,
    });
  });

  it("reports account statement opening, running, and closing balances", async () => {
    const account = await createAccount(`Statement ${newId("account")}`);
    const today = getLagosBusinessDate(new Date());
    const [year, month, day] = today.split("-").map(Number);
    const todayStart = new Date(Date.UTC(year!, month! - 1, day!, 12));
    const priorDay = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const movementTime = (minutes: number) =>
      new Date(todayStart.getTime() + minutes * 60_000).toISOString();
    const opening = await h.app.inject({
      method: "POST",
      url: `/accounts/${account.id}/opening-balance`,
      payload: { amountKobo: "10000", occurredAt: priorDay.toISOString() },
    });
    expect(opening.statusCode).toBe(201);
    const outflow = await h.app.inject({
      method: "POST",
      url: `/accounts/${account.id}/movements`,
      payload: {
        type: "OWNER_DRAWING",
        amountKobo: "3000",
        note: "Statement outflow",
        occurredAt: movementTime(1),
      },
    });
    expect(outflow.statusCode).toBe(201);
    const inflow = await h.app.inject({
      method: "POST",
      url: `/accounts/${account.id}/movements`,
      payload: {
        type: "OTHER_INCOME",
        amountKobo: "2000",
        note: "Statement inflow",
        occurredAt: movementTime(2),
      },
    });
    expect(inflow.statusCode).toBe(201);

    const statement = await h.app.inject({
      method: "GET",
      url: `/accounts/${account.id}/statement?from=${today}&to=${today}`,
    });
    expect(statement.statusCode).toBe(200);
    expect(statement.json<{
      openingBalanceKobo: string;
      closingBalanceKobo: string;
      entries: Array<{ amountKobo: string; runningBalanceKobo: string }>;
    }>()).toMatchObject({
      openingBalanceKobo: "10000",
      closingBalanceKobo: "9000",
      entries: [
        { amountKobo: "-3000", runningBalanceKobo: "7000" },
        { amountKobo: "2000", runningBalanceKobo: "9000" },
      ],
    });
  });

  it("refuses an unaffordable transfer without writing either ledger leg", async () => {
    const source = await createAccount(`Empty source ${newId("account")}`);
    const destination = await createAccount(`Empty destination ${newId("account")}`);
    const before = await h.pg.query(
      `SELECT count(*)::int AS count FROM account_ledger_entries WHERE "accountId" = ANY($1::text[])`,
      [[source.id, destination.id]],
    );
    const response = await h.app.inject({
      method: "POST",
      url: "/account-transfers",
      payload: {
        fromAccountId: source.id,
        toAccountId: destination.id,
        amountKobo: "1",
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { message: string } }>().error.message).toContain(source.name);
    expect(response.json<{ error: { message: string } }>().error.message).toContain(
      "record income or reconcile first",
    );
    const after = await h.pg.query(
      `SELECT count(*)::int AS count FROM account_ledger_entries WHERE "accountId" = ANY($1::text[])`,
      [[source.id, destination.id]],
    );
    expect(after.rows[0].count).toBe(before.rows[0].count);
    expect(await accountBalanceOf(h.pg, source.id)).toBe(0n);
    expect(await accountBalanceOf(h.pg, destination.id)).toBe(0n);
  });

  it("refuses reversing an inflow after its money has been spent", async () => {
    const account = await createAccount(`Spent income ${newId("account")}`);
    const inflow = await h.app.inject({
      method: "POST",
      url: `/accounts/${account.id}/movements`,
      payload: { type: "OTHER_INCOME", amountKobo: "1000", note: "Test proceeds" },
    });
    expect(inflow.statusCode).toBe(201);
    const entryId = inflow.json<{ id: string }>().id;
    const outflow = await h.app.inject({
      method: "POST",
      url: `/accounts/${account.id}/movements`,
      payload: { type: "OWNER_DRAWING", amountKobo: "1000", note: "Spend income" },
    });
    expect(outflow.statusCode).toBe(201);
    const before = await h.pg.query(
      `SELECT count(*)::int AS count FROM account_ledger_entries WHERE "accountId" = $1`,
      [account.id],
    );

    const reversal = await h.app.inject({
      method: "POST",
      url: `/account-entries/${entryId}/reverse`,
      payload: { reason: "Income was entered in error" },
    });
    expect(reversal.statusCode).toBe(409);
    expect(reversal.json<{ error: { message: string } }>().error.message).toContain(account.name);
    expect(reversal.json<{ error: { message: string } }>().error.message).toContain(
      "record income or reconcile first",
    );
    const after = await h.pg.query(
      `SELECT count(*)::int AS count FROM account_ledger_entries WHERE "accountId" = $1`,
      [account.id],
    );
    expect(after.rows[0].count).toBe(before.rows[0].count);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(0n);
  });

  it("records all four manual movement types with the correct sign", async () => {
    const account = await createAccount(`Manual movements ${newId("account")}`);
    const actions = [
      { type: "OWNER_CAPITAL", amountKobo: "1000", expected: "1000" },
      { type: "OTHER_INCOME", amountKobo: "2000", expected: "2000" },
      { type: "OWNER_DRAWING", amountKobo: "500", expected: "-500" },
      { type: "BANK_OR_POS_CHARGE", amountKobo: "250", expected: "-250" },
    ] as const;
    const actual: string[] = [];
    for (const action of actions) {
      const response = await h.app.inject({
        method: "POST",
        url: `/accounts/${account.id}/movements`,
        payload: { type: action.type, amountKobo: action.amountKobo, note: `Record ${action.type}` },
      });
      expect(response.statusCode, response.body).toBe(201);
      actual.push(response.json<{ amountKobo: string }>().amountKobo);
      expect(actual.at(-1)).toBe(action.expected);
    }
    expect(await accountBalanceOf(h.pg, account.id)).toBe(2250n);
  });

  it("serializes competing spends on a zero-after-one balance (10 iterations)", async () => {
    for (let iteration = 0; iteration < 10; iteration += 1) {
      const account = await createAccount(`Concurrent ${iteration} ${newId("account")}`);
      const opening = await h.app.inject({
        method: "POST",
        url: `/accounts/${account.id}/opening-balance`,
        payload: { amountKobo: "100" },
      });
      expect(opening.statusCode).toBe(201);
      const responses = await Promise.all(
        [0, 1].map(() =>
          h.app.inject({
            method: "POST",
            url: `/accounts/${account.id}/movements`,
            payload: { type: "OWNER_DRAWING", amountKobo: "100", note: "Concurrent spend" },
          }),
        ),
      );
      expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(1);
      expect(responses.filter((response) => response.statusCode !== 201)).toHaveLength(1);
      expect(await accountBalanceOf(h.pg, account.id)).toBe(0n);
    }
  }, 90_000);
});
