import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDbAudit } from "../src/db/audit.js";
import {
  accountBalanceOf,
  connectionString,
  createHarness,
  fundAccount,
  newId,
  seedAccount,
  seedCustomer,
  type Harness,
} from "./sales-fixtures.js";

let h!: Harness;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

const NAIRA = 100n; // kobo per naira

async function holdingAccountId(): Promise<string> {
  const { rows } = await h.pg.query<{ id: string }>(`SELECT id FROM accounts WHERE "isHolding"`);
  expect(rows.length).toBe(1);
  return rows[0]!.id;
}

async function heldOf(customerId: string): Promise<bigint> {
  const { rows } = await h.pg.query<{ amountKobo: string }>(
    `SELECT "amountKobo"::text FROM empties_deposit_balances WHERE "customerId" = $1`,
    [customerId],
  );
  return BigInt(rows[0]?.amountKobo ?? "0");
}

const naira = (value: bigint) => (value * NAIRA).toString();

function deposit(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return h.app.inject({ method: "POST", url: "/empties/deposits", payload: body, headers });
}

function reverse(id: string, reason = "Entered in error") {
  return h.app.inject({ method: "POST", url: `/empties/deposits/${id}/reverse`, payload: { reason } });
}

function latestCount(route: string): number | undefined {
  const entry = h.txLog.filter((item) => item.route === route).at(-1);
  return typeof entry?.queries === "number" ? entry.queries : undefined;
}

async function seedCrates(customerId: string, quantity: number) {
  const owner = await h.app.inject({
    method: "POST",
    url: "/empties/owners",
    payload: { name: `Deposit owner ${newId("o")}`.slice(0, 60) },
  });
  expect(owner.statusCode, owner.body).toBe(201);
  const type = await h.app.inject({
    method: "POST",
    url: "/empties/types",
    payload: {
      ownerId: owner.json<{ id: string }>().id,
      kind: "CRATE",
      label: `Dep ${newId("t")}`.slice(0, 40),
      unitValueKobo: "12500",
    },
  });
  expect(type.statusCode, type.body).toBe(201);
  const typeId = type.json<{ id: string }>().id;
  const opening = await h.app.inject({
    method: "POST",
    url: "/empties/movements",
    payload: { typeId, movementType: "OPENING", quantity },
  });
  expect(opening.statusCode, opening.body).toBe(201);
  const taken = await h.app.inject({
    method: "POST",
    url: "/empties/customer-movements",
    payload: { customerId, typeId, movementType: "TAKEN", quantity },
  });
  expect(taken.statusCode, taken.body).toBe(201);
  return typeId;
}

async function crateBalance(customerId: string, typeId: string): Promise<number> {
  const { rows } = await h.pg.query<{ quantity: number }>(
    `SELECT quantity FROM empties_customer_balances WHERE "customerId" = $1 AND "typeId" = $2`,
    [customerId, typeId],
  );
  return rows[0]?.quantity ?? 0;
}

describe("customer deposit route enumeration", () => {
  it("registers each deposit endpoint", () => {
    for (const [method, url] of [
      ["GET", "/empties/deposit-balances"],
      ["GET", "/empties/deposits"],
      ["POST", "/empties/deposits"],
      ["POST", "/empties/deposits/:id/reverse"],
    ]) {
      expect(h.routes.some((r) => r.method === method && r.url === url), `${method} ${url}`).toBe(true);
    }
  });
});

describe("customer crate deposits", () => {
  it("keeps held deposits out of financial position and money flow", async () => {
    const customer = await seedCustomer(h.pg);
    const position = async () =>
      (await h.app.inject({ method: "GET", url: "/reports/financial-position" })).body;
    const before = await position();
    const made = await deposit({ customerId: customer.id, movementType: "RECEIVED", amountKobo: naira(2500n) });
    expect(made.statusCode, made.body).toBe(201);
    // Hand calculation: 2,500 naira sits in the holding account, which business cash ignores.
    expect(await position()).toEqual(before);
    const flow = await h.app.inject({ method: "GET", url: "/reports/money-flow" });
    expect(flow.statusCode, flow.body).toBe(200);
    expect(flow.body).not.toContain("Crate deposit received");
  }, 300_000);

  it("receives, refunds and reverses, leaving reports untouched", async () => {
    const customer = await seedCustomer(h.pg);

    const before = {
      sales: (await h.app.inject({ method: "GET", url: "/reports/sales-summary" })).body,
      dash: (await h.app.inject({ method: "GET", url: "/reports/dashboard" })).body,
    };

    const received = await deposit({
      customerId: customer.id,
      movementType: "RECEIVED",
      amountKobo: naira(5000n),
    });
    expect(received.statusCode, received.body).toBe(201);
    expect(latestCount("POST /empties/deposits")).toBe(9);
    const holding = await holdingAccountId();
    const holdingStart = await accountBalanceOf(h.pg, holding);
    expect(await heldOf(customer.id)).toBe(5000n * NAIRA);
    // Hand calculation: 5,000 naira received -> held 500,000 kobo.

    const after = {
      sales: (await h.app.inject({ method: "GET", url: "/reports/sales-summary" })).body,
      dash: (await h.app.inject({ method: "GET", url: "/reports/dashboard" })).body,
    };
    expect(after).toEqual(before);

    const refund = await deposit({
      customerId: customer.id,
      movementType: "REFUNDED",
      amountKobo: naira(3000n),
    });
    expect(refund.statusCode, refund.body).toBe(201);
    expect(await heldOf(customer.id)).toBe(2000n * NAIRA);
    expect(await accountBalanceOf(h.pg, holding)).toBe(holdingStart - 3000n * NAIRA);
    // Hand calculation: 5,000 - 3,000 = 2,000 held; holding account falls by 3,000.

    const again = await deposit({
      customerId: customer.id,
      movementType: "REFUNDED",
      amountKobo: naira(3000n),
    });
    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: { message: string } }>().error.message).toContain("holds only");
    expect(await heldOf(customer.id)).toBe(2000n * NAIRA);

    const reversed = await reverse(refund.json<{ id: string }>().id);
    expect(reversed.statusCode, reversed.body).toBe(201);
    expect(await heldOf(customer.id)).toBe(5000n * NAIRA);
    expect(await accountBalanceOf(h.pg, holding)).toBe(holdingStart);

    const list = await h.app.inject({ method: "GET", url: `/empties/deposits?customerId=${customer.id}` });
    expect(list.statusCode, list.body).toBe(200);
    const balances = await h.app.inject({ method: "GET", url: "/empties/deposit-balances" });
    expect(balances.statusCode, balances.body).toBe(200);
    expect(balances.body).toContain(customer.id);
  }, 300_000);

  it("refuses to reverse a deposit when the holding account lacks the cash", async () => {
    const customer = await seedCustomer(h.pg);
    const received = await deposit({
      customerId: customer.id,
      movementType: "RECEIVED",
      amountKobo: naira(1000n),
    });
    expect(received.statusCode, received.body).toBe(201);
    const refund = await deposit({
      customerId: customer.id,
      movementType: "REFUNDED",
      amountKobo: naira(1000n),
    });
    expect(refund.statusCode, refund.body).toBe(201);
    // The deposit is already refunded: undoing the receipt would drop the customer below zero.
    const bad = await reverse(received.json<{ id: string }>().id);
    expect(bad.statusCode).toBe(409);
    expect(await heldOf(customer.id)).toBe(0n);
  }, 120_000);

  it("forfeits to a main account and reduces crates owed by the same quantity", async () => {
    const customer = await seedCustomer(h.pg);
    const typeId = await seedCrates(customer.id, 10);
    const main = await seedAccount(h.pg);
    await fundAccount(h.pg, main.id, 0n + 1n);
    const holding = await holdingAccountId();

    await deposit({ customerId: customer.id, movementType: "RECEIVED", amountKobo: naira(4000n) });
    const mainStart = await accountBalanceOf(h.pg, main.id);

    const noNote = await deposit({
      customerId: customer.id,
      movementType: "FORFEITED",
      amountKobo: naira(1500n),
      typeId,
      quantity: 3,
      toAccountId: main.id,
    });
    expect(noNote.statusCode).toBe(400);

    const holdingStart = await accountBalanceOf(h.pg, holding);
    const forfeit = await deposit({
      customerId: customer.id,
      movementType: "FORFEITED",
      amountKobo: naira(1500n),
      typeId,
      quantity: 3,
      toAccountId: main.id,
      note: "Customer did not return 3 crates",
    });
    expect(forfeit.statusCode, forfeit.body).toBe(201);
    expect(latestCount("POST /empties/deposits")).toBe(13);
    expect(await heldOf(customer.id)).toBe(2500n * NAIRA);
    expect(await accountBalanceOf(h.pg, main.id)).toBe(mainStart + 1500n * NAIRA);
    expect(await accountBalanceOf(h.pg, holding)).toBe(holdingStart - 1500n * NAIRA);
    expect(await crateBalance(customer.id, typeId)).toBe(7);
    // Hand calculation: 4,000 held - 1,500 = 2,500; crates 10 - 3 = 7.

    const tooMany = await deposit({
      customerId: customer.id,
      movementType: "FORFEITED",
      amountKobo: naira(100n),
      typeId,
      quantity: 8,
      toAccountId: main.id,
      note: "too many",
    });
    expect(tooMany.statusCode).toBe(409);
    expect(await crateBalance(customer.id, typeId)).toBe(7);

    const undo = await reverse(forfeit.json<{ id: string }>().id);
    expect(undo.statusCode, undo.body).toBe(201);
    expect(await heldOf(customer.id)).toBe(4000n * NAIRA);
    expect(await accountBalanceOf(h.pg, main.id)).toBe(mainStart);
    expect(await crateBalance(customer.id, typeId)).toBe(10);
  }, 120_000);

  it("refuses to reverse the crate row or the transfer of a forfeit on its own", async () => {
    const customer = await seedCustomer(h.pg);
    const typeId = await seedCrates(customer.id, 5);
    const main = await seedAccount(h.pg);
    await deposit({ customerId: customer.id, movementType: "RECEIVED", amountKobo: naira(1000n) });
    const forfeit = await deposit({
      customerId: customer.id,
      movementType: "FORFEITED",
      amountKobo: naira(500n),
      typeId,
      quantity: 1,
      toAccountId: main.id,
      note: "kept",
    });
    expect(forfeit.statusCode, forfeit.body).toBe(201);
    const row = forfeit.json<{ customerMovementId: string; accountTransferId: string }>();

    const crate = await h.app.inject({
      method: "POST",
      url: `/empties/customer-movements/${row.customerMovementId}/reverse`,
      payload: { reason: "oops" },
    });
    expect(crate.statusCode).toBe(409);
    const transfer = await h.app.inject({
      method: "POST",
      url: `/account-transfers/${row.accountTransferId}/reverse`,
      payload: { reason: "oops" },
    });
    expect(transfer.statusCode).toBeGreaterThanOrEqual(400);
    expect(await crateBalance(customer.id, typeId)).toBe(4);
  }, 120_000);

  it("refuses to overdraw the holding account and never changes anything", async () => {
    const customer = await seedCustomer(h.pg);
    const refund = await deposit({
      customerId: customer.id,
      movementType: "REFUNDED",
      amountKobo: naira(10n),
    });
    expect(refund.statusCode).toBe(409);
    expect(await heldOf(customer.id)).toBe(0n);
  });

  it("replays an idempotent request without a second movement", async () => {
    const customer = await seedCustomer(h.pg);
    const key = newId("dep-key");
    const body = { customerId: customer.id, movementType: "RECEIVED", amountKobo: naira(700n) };
    const first = await deposit(body, { "idempotency-key": key });
    const second = await deposit(body, { "idempotency-key": key });
    expect(first.statusCode, first.body).toBe(201);
    expect(second.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id);
    expect(await heldOf(customer.id)).toBe(700n * NAIRA);
  });

  it("lets exactly one of two simultaneous refunds of the last amount succeed", async () => {
    for (let i = 0; i < 3; i += 1) {
      const customer = await seedCustomer(h.pg);
      await deposit({ customerId: customer.id, movementType: "RECEIVED", amountKobo: naira(900n) });
      const body = { customerId: customer.id, movementType: "REFUNDED", amountKobo: naira(900n) };
      const results = await Promise.all([deposit(body), deposit(body)]);
      const codes = results.map((r) => r.statusCode).sort();
      expect(codes, results.map((r) => r.body).join(" | ")).toEqual([201, 409]);
      expect(await heldOf(customer.id)).toBe(0n);
    }
  }, 120_000);

  it("rejects UPDATE and DELETE on deposit movements", async () => {
    const customer = await seedCustomer(h.pg);
    const made = await deposit({ customerId: customer.id, movementType: "RECEIVED", amountKobo: naira(50n) });
    const id = made.json<{ id: string }>().id;
    await expect(h.pg.query(`UPDATE empties_deposit_movements SET note = 'x' WHERE id = $1`, [id])).rejects.toThrow();
    await expect(h.pg.query(`DELETE FROM empties_deposit_movements WHERE id = $1`, [id])).rejects.toThrow();
  });
});

describe("the holding account", () => {
  it("is refused by the account routes and hidden from business cash", async () => {
    const customer = await seedCustomer(h.pg);
    await deposit({ customerId: customer.id, movementType: "RECEIVED", amountKobo: naira(300n) });
    const holding = await holdingAccountId();
    const other = await seedAccount(h.pg);

    const rename = await h.app.inject({ method: "PATCH", url: `/accounts/${holding}`, payload: { name: "Mine" } });
    expect(rename.statusCode).toBeGreaterThanOrEqual(400);
    const deactivate = await h.app.inject({ method: "POST", url: `/accounts/${holding}/deactivate` });
    expect(deactivate.statusCode).toBeGreaterThanOrEqual(400);
    const reconcile = await h.app.inject({
      method: "POST",
      url: `/accounts/${holding}/reconcile`,
      payload: { countedKobo: "0", reason: "x" },
    });
    expect(reconcile.statusCode).toBeGreaterThanOrEqual(400);
    const transfer = await h.app.inject({
      method: "POST",
      url: "/account-transfers",
      payload: { fromAccountId: holding, toAccountId: other.id, amountKobo: "100" },
    });
    expect(transfer.statusCode).toBeGreaterThanOrEqual(400);

    const list = await h.app.inject({ method: "GET", url: "/accounts" });
    const flagged = list.json<Array<{ id: string; isHolding: boolean }>>().find((a) => a.id === holding);
    expect(flagged?.isHolding).toBe(true);
  }, 120_000);
});

describe("deposit audit", () => {
  it("db:audit reports zero rows for every deposit check", async () => {
    const audit = await runDbAudit(connectionString);
    const failing = audit.checks.filter((c) => c.severity === "fatal" && (c.rowCount !== 0 || c.error));
    expect(failing).toEqual([]);
    expect(audit.ok).toBe(true);
  }, 120_000);
});
