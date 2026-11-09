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
});
