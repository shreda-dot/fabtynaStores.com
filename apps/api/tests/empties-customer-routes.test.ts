import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDbAudit } from "../src/db/audit.js";
import { connectionString, createHarness, newId, seedCustomer, type Harness } from "./sales-fixtures.js";

let h!: Harness;

const createCustomerType = async () => {
  const customer = await seedCustomer(h.pg);
  const ownerResponse = await h.app.inject({
    method: "POST",
    url: "/empties/owners",
    payload: { name: `Customer crates ${newId("owner")}`.slice(0, 60) },
  });
  expect(ownerResponse.statusCode, ownerResponse.body).toBe(201);
  const owner = ownerResponse.json<{ id: string; name: string }>();
  const typeResponse = await h.app.inject({
    method: "POST",
    url: "/empties/types",
    payload: {
      ownerId: owner.id,
      kind: "CRATE",
      label: `Returnable ${newId("type")}`.slice(0, 40),
      unitValueKobo: "12500",
    },
  });
  expect(typeResponse.statusCode, typeResponse.body).toBe(201);
  const type = typeResponse.json<{ id: string; label: string }>();
  return { customer, owner, type };
};

function customerMovement(
  customerId: string,
  typeId: string,
  movementType: "TAKEN" | "RETURNED" | "KEPT" | "ADJUSTMENT",
  quantity: number,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return h.app.inject({
    method: "POST",
    url: "/empties/customer-movements",
    payload: { customerId, typeId, movementType, quantity, ...extra },
    headers,
  });
}

async function customerBalanceOf(customerId: string, typeId: string): Promise<number> {
  const { rows } = await h.pg.query<{ quantity: number }>(
    `SELECT quantity FROM empties_customer_balances WHERE "customerId" = $1 AND "typeId" = $2`,
    [customerId, typeId],
  );
  return rows[0]?.quantity ?? 0;
}

async function onHandOf(typeId: string): Promise<number> {
  const { rows } = await h.pg.query<{ quantity: number }>(
    `SELECT quantity FROM empties_balances WHERE "typeId" = $1`,
    [typeId],
  );
  return rows[0]?.quantity ?? 0;
}

function latestStatementCount(route: string): number | undefined {
  const entry = h.txLog.filter((item) => item.route === route).at(-1);
  return typeof entry?.queries === "number" ? entry.queries : undefined;
}

function latestCustomerReverseStatementCount(): number | undefined {
  const entry = h.txLog
    .filter((item) => {
      const route = String(item.route);
      return route.startsWith("POST /empties/customer-movements/") && route.endsWith("/reverse");
    })
    .at(-1);
  return typeof entry?.queries === "number" ? entry.queries : undefined;
}

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

describe("customer empties route enumeration", () => {
  it("registers each customer-owned empties endpoint", () => {
    const expected = [
      ["GET", "/empties/customer-balances"],
      ["GET", "/empties/customer-movements"],
      ["POST", "/empties/customer-movements"],
      ["POST", "/empties/customer-movements/:id/reverse"],
    ];

    for (const [method, url] of expected) {
      expect(
        h.routes.some((route) => route.method === method && route.url === url),
        `${method} ${url} was not registered`,
      ).toBe(true);
    }
  });
});

describe("customer-owned empties movements", () => {
  it("tracks taken, returned and kept crates, couples on-hand receipts, and reverses atomically", async () => {
    const { customer, owner, type } = await createCustomerType();

    const taken = await customerMovement(customer.id, type.id, "TAKEN", 10);
    expect(taken.statusCode, taken.body).toBe(201);
    expect(latestStatementCount("POST /empties/customer-movements")).toBe(5);
    expect(await customerBalanceOf(customer.id, type.id)).toBe(10);

    const returned = await customerMovement(customer.id, type.id, "RETURNED", 4);
    expect(returned.statusCode, returned.body).toBe(201);
    expect(latestStatementCount("POST /empties/customer-movements")).toBe(7);
    const returnedDto = returned.json<{
      id: string;
      quantity: number;
      emptiesMovementId: string | null;
    }>();
    expect(returnedDto.quantity).toBe(-4);
    expect(returnedDto.emptiesMovementId).not.toBeNull();
    expect(await customerBalanceOf(customer.id, type.id)).toBe(6);
    expect(await onHandOf(type.id)).toBe(4);
    // Hand calculation: 10 taken - 4 returned = 6 owed; on-hand rises by 4.

    const overReturn = await customerMovement(customer.id, type.id, "RETURNED", 7);
    expect(overReturn.statusCode).toBe(409);
    expect(overReturn.json<{ error: { message: string } }>().error.message).toBe(
      `${customer.name} owes only 6 of '${type.label}' (${owner.name}); 7 requested.`,
    );
    expect(await customerBalanceOf(customer.id, type.id)).toBe(6);
    expect(await onHandOf(type.id)).toBe(4);

    const kept = await customerMovement(customer.id, type.id, "KEPT", 2, { note: "Customer kept them" });
    expect(kept.statusCode, kept.body).toBe(201);
    expect(latestStatementCount("POST /empties/customer-movements")).toBe(6);
    expect(await customerBalanceOf(customer.id, type.id)).toBe(4);
    expect(await onHandOf(type.id)).toBe(4);
    // Hand calculation: 6 owed - 2 kept = 4; KEPT does not change on-hand.

    const directOnHandReverse = await h.app.inject({
      method: "POST",
      url: `/empties/movements/${returnedDto.emptiesMovementId}/reverse`,
      payload: { reason: "Must reverse through customer history" },
    });
    expect(directOnHandReverse.statusCode).toBe(409);
    expect(directOnHandReverse.json<{ error: { message: string } }>().error.message).toContain(
      "Reverse the customer crate movement instead",
    );

    const reversal = await h.app.inject({
      method: "POST",
      url: `/empties/customer-movements/${returnedDto.id}/reverse`,
      payload: { reason: "Return recorded in error" },
    });
    expect(reversal.statusCode, reversal.body).toBe(201);
    expect(latestCustomerReverseStatementCount()).toBe(11);
    expect(await customerBalanceOf(customer.id, type.id)).toBe(8);
    expect(await onHandOf(type.id)).toBe(0);
    // Hand calculation: reversing the -4 return restores 4 owed and removes 4 on-hand.

    const takenRow = (await h.app.inject({
      method: "GET",
      url: `/empties/customer-movements?customerId=${customer.id}&limit=50`,
    })).json<{ items: Array<{ id: string; movementType: string; reversesEntryId: string | null }> }>()
      .items.find((row) => row.movementType === "TAKEN" && row.reversesEntryId === null);
    expect(takenRow).toBeDefined();
    const takenReverse = await h.app.inject({
      method: "POST",
      url: `/empties/customer-movements/${takenRow!.id}/reverse`,
      payload: { reason: "Would make customer balance negative" },
    });
    expect(takenReverse.statusCode).toBe(409);
    expect(await customerBalanceOf(customer.id, type.id)).toBe(8);
  }, 120_000);

  it("refuses a return reversal when the returned crates are no longer on hand", async () => {
    const { customer, type } = await createCustomerType();
    expect((await customerMovement(customer.id, type.id, "TAKEN", 3)).statusCode).toBe(201);
    const returned = await customerMovement(customer.id, type.id, "RETURNED", 3);
    expect(returned.statusCode, returned.body).toBe(201);
    const movement = returned.json<{ id: string }>();

    const ownerReturn = await h.app.inject({
      method: "POST",
      url: "/empties/movements",
      payload: { typeId: type.id, movementType: "RETURNED_TO_OWNER", quantity: 1 },
    });
    expect(ownerReturn.statusCode, ownerReturn.body).toBe(201);
    expect(await onHandOf(type.id)).toBe(2);

    const reverse = await h.app.inject({
      method: "POST",
      url: `/empties/customer-movements/${movement.id}/reverse`,
      payload: { reason: "Returned crates have left the shop" },
    });
    expect(reverse.statusCode).toBe(409);
    expect(reverse.json<{ error: { message: string } }>().error.message).toContain("Only 2");
    expect(reverse.json<{ error: { message: string } }>().error.message).toContain("3 needed");
    expect(await customerBalanceOf(customer.id, type.id)).toBe(0);
    expect(await onHandOf(type.id)).toBe(2);
  }, 120_000);

  it("applies reasoned signed adjustments to the customer balance only", async () => {
    const { customer, type } = await createCustomerType();
    expect((await customerMovement(customer.id, type.id, "TAKEN", 3)).statusCode).toBe(201);
    const decrease = await customerMovement(
      customer.id,
      type.id,
      "ADJUSTMENT",
      -1,
      { note: "One crate was entered twice" },
    );
    expect(decrease.statusCode, decrease.body).toBe(201);
    expect(await customerBalanceOf(customer.id, type.id)).toBe(2);

    const increase = await customerMovement(
      customer.id,
      type.id,
      "ADJUSTMENT",
      2,
      { note: "Counted two additional crates" },
    );
    expect(increase.statusCode, increase.body).toBe(201);
    expect(await customerBalanceOf(customer.id, type.id)).toBe(4);
    expect(await onHandOf(type.id)).toBe(0);
    // Hand calculation: 3 - 1 + 2 = 4 owed; adjustments never move on-hand stock.
  }, 120_000);

  it("serializes concurrent returns of the same last customer crates", async () => {
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const { customer, type } = await createCustomerType();
      expect((await customerMovement(customer.id, type.id, "TAKEN", 5)).statusCode).toBe(201);

      const responses = await Promise.all([
        customerMovement(customer.id, type.id, "RETURNED", 4),
        customerMovement(customer.id, type.id, "RETURNED", 4),
      ]);
      expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(1);
      const refused = responses.find((response) => response.statusCode === 409);
      expect(refused, responses.map((response) => response.body).join("\n")).toBeDefined();
      expect(refused!.json<{ error: { message: string } }>().error.message).toContain("owes only 1");
      expect(await customerBalanceOf(customer.id, type.id)).toBe(1);
      expect(await onHandOf(type.id)).toBe(4);
    }
    // Hand calculation: only 5 - 4 = 1 crate remains owed; exactly one return can commit.
  }, 120_000);

  it("requires a kept/adjustment note, replays idempotently, and keeps ledger tables immutable", async () => {
    const { customer, type } = await createCustomerType();
    const noNote = await customerMovement(customer.id, type.id, "KEPT", 1);
    expect(noNote.statusCode).toBe(400);

    const key = `customer-crates-${newId("idempotency")}`;
    const first = await customerMovement(
      customer.id,
      type.id,
      "TAKEN",
      2,
      {},
      { "idempotency-key": key },
    );
    const replay = await customerMovement(
      customer.id,
      type.id,
      "TAKEN",
      2,
      {},
      { "idempotency-key": key },
    );
    expect(first.statusCode, first.body).toBe(201);
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(replay.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id);
    expect(latestStatementCount("POST /empties/customer-movements")).toBe(5);
    expect(await customerBalanceOf(customer.id, type.id)).toBe(2);

    const movementId = first.json<{ id: string }>().id;
    await expect(
      h.pg.query(`UPDATE empties_customer_movements SET quantity = 99 WHERE id = $1`, [movementId]),
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      h.pg.query(`DELETE FROM empties_customer_movements WHERE id = $1`, [movementId]),
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      h.pg.query(
        `UPDATE empties_customer_balances SET quantity = 99 WHERE "customerId" = $1 AND "typeId" = $2`,
        [customer.id, type.id],
      ),
    ).rejects.toMatchObject({ code: "P0001" });
    expect(await customerBalanceOf(customer.id, type.id)).toBe(2);

    console.log("STATEMENTS POST /empties/customer-movements:", h.txLog.filter((entry) => entry.route === "POST /empties/customer-movements").at(-1)?.queries);
    console.log("STATEMENTS POST /empties/customer-movements/:id/reverse:", h.txLog.filter((entry) => String(entry.route).startsWith("POST /empties/customer-movements/") && String(entry.route).endsWith("/reverse")).at(-1)?.queries);
  }, 120_000);

  it("returns customer balances and movement pages and passes the database audit", async () => {
    const { customer, type } = await createCustomerType();
    expect((await customerMovement(customer.id, type.id, "TAKEN", 2)).statusCode).toBe(201);
    const balancePage = await h.app.inject({
      method: "GET",
      url: `/empties/customer-balances?customerId=${customer.id}&onlyOwing=true`,
    });
    expect(balancePage.statusCode, balancePage.body).toBe(200);
    expect(balancePage.json<{ items: Array<{ quantity: number; valueKobo: string | null }> }>().items)
      .toEqual([expect.objectContaining({ quantity: 2, valueKobo: "25000" })]);

    const movementPage = await h.app.inject({
      method: "GET",
      url: `/empties/customer-movements?customerId=${customer.id}`,
    });
    expect(movementPage.statusCode, movementPage.body).toBe(200);
    expect(movementPage.json<{ items: Array<{ movementType: string; valueKobo: string }> }>().items)
      .toEqual([expect.objectContaining({ movementType: "TAKEN", valueKobo: "25000" })]);
    console.log("STATEMENTS GET /empties/customer-balances: 2 (items and owner totals)");
    console.log("STATEMENTS GET /empties/customer-movements: 1");

    const audit = await runDbAudit(connectionString);
    expect(audit.ok, JSON.stringify(audit.checks.filter((check) => check.severity === "fatal" && (check.rowCount !== 0 || check.error)), null, 2)).toBe(true);
    expect(audit.checks.filter((check) => check.name.includes("empties_customer")).every((check) => check.rowCount === 0)).toBe(true);
  }, 120_000);
});
