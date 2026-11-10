import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getLagosBusinessDate } from "@fabtyna/shared";
import { accountBalanceOf, createHarness, newId, type Harness } from "./sales-fixtures.js";

let h: Harness;

beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { if (h) await h.close(); });

describe("Family Support", () => {
  it("posts once, excludes reversed drawings from totals, and refuses overspending", async () => {
    const memberResponse = await h.app.inject({
      method: "POST", url: "/family-members",
      payload: { name: newId("beneficiary"), relationship: "Family" },
    });
    expect(memberResponse.statusCode, memberResponse.body).toBe(201);
    const member = memberResponse.json<{ id: string }>();
    const accountResponse = await h.app.inject({
      method: "POST", url: "/accounts", payload: { name: newId("family-account"), type: "BANK" },
    });
    expect(accountResponse.statusCode, accountResponse.body).toBe(201);
    const account = accountResponse.json<{ id: string }>();
    const opening = await h.app.inject({
      method: "POST", url: `/accounts/${account.id}/opening-balance`, payload: { amountKobo: "10000" },
    });
    expect(opening.statusCode, opening.body).toBe(201);
    const positionBefore = await h.app.inject({ method: "GET", url: "/reports/financial-position" });
    expect(positionBefore.statusCode, positionBefore.body).toBe(200);
    const beforeDrawings = BigInt(positionBefore.json<{ ownerWithdrawals: { drawingsKobo: string } }>().ownerWithdrawals.drawingsKobo);
    const payload = {
      beneficiaryId: member.id, purpose: "MEDICAL", accountId: account.id,
      amountKobo: "6000", occurredAt: new Date().toISOString(), note: null,
    };
    const headers = { "idempotency-key": newId("drawing") };
    const created = await h.app.inject({ method: "POST", url: "/drawings", headers, payload });
    expect(created.statusCode, created.body).toBe(201);
    const replay = await h.app.inject({ method: "POST", url: "/drawings", headers, payload });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json()).toEqual(created.json());
    expect(await accountBalanceOf(h.pg, account.id)).toBe(4000n);
    const insufficient = await h.app.inject({ method: "POST", url: "/drawings", payload: { ...payload, amountKobo: "5000" } });
    expect(insufficient.statusCode).toBeGreaterThanOrEqual(400);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(4000n);
    const today = getLagosBusinessDate(new Date());
    const query = `/drawings?from=${today}&to=${today}&accountId=${account.id}`;
    const listed = await h.app.inject({ method: "GET", url: query });
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json<{ report: { totalKobo: string; count: number } }>().report).toMatchObject({ totalKobo: "6000", count: 1 });
    const flow = await h.app.inject({ method: "GET", url: `/reports/money-flow?from=${today}&to=${today}&accountId=${account.id}` });
    expect(flow.statusCode, flow.body).toBe(200);
    expect(flow.json<{ rows: Array<{ categories: Array<{ key: string; moneyOutKobo: string }> }> }>().rows[0].categories)
      .toContainEqual({ key: "OWNER_DRAWING", moneyInKobo: "0", moneyOutKobo: "6000" });
    const statement = await h.app.inject({ method: "GET", url: `/accounts/${account.id}/statement?from=${today}&to=${today}` });
    expect(statement.statusCode, statement.body).toBe(200);
    expect(statement.json<{ entries: Array<{ type: string; sourceDescription: string }> }>().entries)
      .toEqual(expect.arrayContaining([expect.objectContaining({ type: "OWNER_DRAWING", sourceDescription: "Owner drawing" })]));
    const positionAfter = await h.app.inject({ method: "GET", url: "/reports/financial-position" });
    expect(positionAfter.statusCode, positionAfter.body).toBe(200);
    expect(BigInt(positionAfter.json<{ ownerWithdrawals: { drawingsKobo: string } }>().ownerWithdrawals.drawingsKobo) - beforeDrawings).toBe(6000n);
    const id = created.json<{ id: string }>().id;
    const reversed = await h.app.inject({ method: "POST", url: `/drawings/${id}/reverse`, payload: { reason: "Correction" } });
    expect(reversed.statusCode, reversed.body).toBe(201);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(10000n);
    const after = await h.app.inject({ method: "GET", url: query });
    expect(after.json<{ report: { totalKobo: string; count: number } }>().report).toMatchObject({ totalKobo: "0", count: 0 });
    const deactivate = await h.app.inject({ method: "POST", url: `/family-members/${member.id}/deactivate` });
    expect(deactivate.statusCode, deactivate.body).toBe(200);
    const inactiveDrawing = await h.app.inject({ method: "POST", url: "/drawings", payload });
    expect(inactiveDrawing.statusCode).toBe(409);
    const reactivate = await h.app.inject({ method: "POST", url: `/family-members/${member.id}/reactivate` });
    expect(reactivate.statusCode, reactivate.body).toBe(200);
    const oldRoute = await h.app.inject({
      method: "POST", url: `/accounts/${account.id}/movements`,
      payload: { type: "OWNER_DRAWING", amountKobo: "1", note: "Old flow" },
    });
    expect(oldRoute.statusCode).toBeGreaterThanOrEqual(400);
    expect(oldRoute.statusCode).toBeLessThan(500);
  }, 120_000);

  it("reports source-linked drawings on the expense date and money flow on the posting date", async () => {
    const memberResponse = await h.app.inject({
      method: "POST", url: "/family-members",
      payload: { name: newId("history-member"), relationship: "Family" },
    });
    expect(memberResponse.statusCode, memberResponse.body).toBe(201);
    const member = memberResponse.json<{ id: string }>();
    const accountResponse = await h.app.inject({
      method: "POST", url: "/accounts",
      payload: { name: newId("history-account"), type: "BANK" },
    });
    expect(accountResponse.statusCode, accountResponse.body).toBe(201);
    const account = accountResponse.json<{ id: string }>();
    const opening = await h.app.inject({
      method: "POST", url: `/accounts/${account.id}/opening-balance`, payload: { amountKobo: "11000" },
    });
    expect(opening.statusCode, opening.body).toBe(201);
    const categoryResponse = await h.app.inject({ method: "GET", url: "/expense-categories" });
    const category = categoryResponse.json<Array<{ id: string; code: string }>>().find((row) => row.code === "OTHER");
    expect(category).toBeDefined();
    const expenseDate = "2020-10-30T23:30:00.000Z";
    const originalDay = "2020-10-31";
    const expenseResponse = await h.app.inject({
      method: "POST", url: "/expenses",
      payload: {
        categoryId: category!.id, channel: "BOTH", description: "Test source expense",
        amountKobo: "10000", expenseDate, accountId: account.id,
      },
    });
    expect(expenseResponse.statusCode, expenseResponse.body).toBe(201);
    const expense = expenseResponse.json<{ id: string }>();
    expect(await accountBalanceOf(h.pg, account.id)).toBe(1000n);
    const voided = await h.app.inject({
      method: "POST", url: `/expenses/${expense.id}/void`, payload: { reason: "Test classification" },
    });
    expect(voided.statusCode, voided.body).toBe(200);
    const entryId = newId("history-entry");
    const drawingId = newId("history-drawing");
    await h.pg.query("BEGIN");
    try {
      await h.pg.query(
        `INSERT INTO account_ledger_entries (id, "accountId", type, "amountKobo", "occurredAt", note)
         VALUES ($1, $2, 'OWNER_DRAWING', -10000, now(), 'Test classification')`,
        [entryId, account.id],
      );
      await h.pg.query(
        `INSERT INTO drawings (id, "entryId", "beneficiaryId", purpose, "sourceExpenseId", "createdById")
         VALUES ($1, $2, $3, 'MEDICAL', $4, $5)`,
        [drawingId, entryId, member.id, expense.id, h.actor.id],
      );
      await h.pg.query("COMMIT");
    } catch (error) {
      await h.pg.query("ROLLBACK");
      throw error;
    }
    expect(await accountBalanceOf(h.pg, account.id)).toBe(1000n);
    const original = await h.app.inject({
      method: "GET", url: `/drawings?from=${originalDay}&to=${originalDay}&accountId=${account.id}`,
    });
    expect(original.statusCode, original.body).toBe(200);
    const history = original.json<{
      items: Array<{ id: string; occurredAt: string; postedAt: string; sourceExpenseId: string }>;
      report: { totalKobo: string; count: number; byBeneficiary: Array<{ id: string; amountKobo: string }>; byPurpose: Array<{ id: string; amountKobo: string }>; byAccount: Array<{ id: string; amountKobo: string }> };
    }>();
    expect(history.report).toMatchObject({ totalKobo: "10000", count: 1 });
    expect(history.report.byBeneficiary[0]).toMatchObject({ id: member.id, amountKobo: "10000" });
    expect(history.report.byPurpose[0]).toMatchObject({ id: "MEDICAL", amountKobo: "10000" });
    expect(history.report.byAccount[0]).toMatchObject({ id: account.id, amountKobo: "10000" });
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({ id: drawingId, occurredAt: expenseDate, sourceExpenseId: expense.id });
    expect(getLagosBusinessDate(new Date(history.items[0].postedAt))).toBe(getLagosBusinessDate());
    const today = getLagosBusinessDate();
    const postedDay = await h.app.inject({
      method: "GET", url: `/drawings?from=${today}&to=${today}&accountId=${account.id}`,
    });
    expect(postedDay.statusCode, postedDay.body).toBe(200);
    expect(postedDay.json<{ report: { count: number } }>().report.count).toBe(0);
    const flow = await h.app.inject({ method: "GET", url: `/reports/money-flow?from=${today}&to=${today}&accountId=${account.id}` });
    expect(flow.statusCode, flow.body).toBe(200);
    expect(flow.json<{ rows: Array<{ categories: Array<{ key: string; moneyOutKobo: string }> }> }>().rows[0].categories)
      .toContainEqual({ key: "OWNER_DRAWING", moneyInKobo: "0", moneyOutKobo: "10000" });
    const statement = await h.app.inject({ method: "GET", url: `/accounts/${account.id}/statement?from=${today}&to=${today}` });
    expect(statement.statusCode, statement.body).toBe(200);
    expect(statement.json<{ entries: Array<{ id: string }> }>().entries)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: entryId })]));
    const reversed = await h.app.inject({ method: "POST", url: `/drawings/${drawingId}/reverse`, payload: { reason: "Test reversal" } });
    expect(reversed.statusCode, reversed.body).toBe(201);
    const after = await h.app.inject({ method: "GET", url: `/drawings?from=${originalDay}&to=${originalDay}&accountId=${account.id}` });
    expect(after.statusCode, after.body).toBe(200);
    expect(after.json<{ report: { totalKobo: string; count: number } }>().report).toMatchObject({ totalKobo: "0", count: 0 });
    expect(await accountBalanceOf(h.pg, account.id)).toBe(11000n);
    const expenseAfter = await h.pg.query<{ voidedAt: Date | null; voidReason: string | null }>(
      'SELECT "voidedAt", "voidReason" FROM expenses WHERE id = $1', [expense.id],
    );
    expect(expenseAfter.rows[0].voidedAt).not.toBeNull();
    expect(expenseAfter.rows[0].voidReason).toBe("Test classification");
    console.log("Reclassified reverse on TEST: account 1000 -> 11000 kobo; expense remains voided; drawings total 10000 -> 0 kobo.");
  }, 120_000);
});
