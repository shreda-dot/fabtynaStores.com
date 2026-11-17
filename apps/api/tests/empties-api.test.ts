import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getLagosBusinessDate } from "@fabtyna/shared";
import { runDbAudit } from "../src/db/audit.js";
import { createWriteRunner } from "../src/lib/tx.js";
import {
  connectionString,
  createHarness,
  newId,
  purchaseBody,
  seedCustomer,
  seedProduct,
  seedSupplier,
  type Harness,
} from "./sales-fixtures.js";

/**
 * Empties tracking: immutable count movements and mutable brewery ownership.
 *
 * `empties_balances` is DERIVED: the AFTER INSERT trigger on `empties_movements`
 * is its only writer, and `trg_empties_balances_guard` rejects anything else.
 * These tests therefore assert both sides: the HTTP response AND the raw row in
 * `empties_balances`, plus the guards that stop the ledger being rewritten.
 */

let h!: Harness;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

interface OwnerDto {
  id: string;
  name: string;
  isActive: boolean;
  typeCount: number;
  activeTypeCount: number;
}

interface TypeDto {
  id: string;
  ownerId: string;
  ownerName: string;
  kind: "BOTTLE" | "CRATE";
  label: string;
  capacity: number | null;
  unitValueKobo: string | null;
  isActive: boolean;
}

interface MovementDto {
  id: string;
  typeId: string;
  movementType: "OPENING" | "RECEIVED" | "RETURNED_TO_OWNER" | "ADJUSTMENT";
  quantity: number;
  note: string | null;
  occurredAt: string;
  reversesEntryId: string | null;
}

interface BalanceItem {
  typeId: string;
  ownerId: string;
  ownerName: string;
  kind: "BOTTLE" | "CRATE";
  label: string;
  unitValueKobo: string | null;
  quantity: number;
  valueKobo: string | null;
}

interface BalancesDto {
  items: BalanceItem[];
  totalsByOwner: Array<{ ownerId: string; ownerName: string; kind: "BOTTLE" | "CRATE"; quantity: number; valueKobo: string }>;
  totalsByKind: Array<{ kind: "BOTTLE" | "CRATE"; quantity: number; valueKobo: string }>;
}

interface ProductOwnerDto {
  productId: string;
  productName: string;
  sku: string | null;
  unitsPerPack: number;
  ownerId: string | null;
  ownerName: string | null;
  ownerIsActive: boolean | null;
}

interface ProductOwnerPageDto {
  items: ProductOwnerDto[];
  nextCursor: string | null;
}

interface ProductOverviewDto {
  productId: string;
  productName: string;
  isActive: boolean;
  unitsPerPack: number;
  warehouseUnits: number;
  fullCrates: number;
  looseUnits: number;
  shelfUnits: number;
  marketUnits: number;
}

interface EmptiesOverviewDto {
  owners: Array<{
    ownerId: string;
    ownerName: string;
    emptyCrates: number;
    emptyBottles: number;
    fullCrates: number;
    looseUnitsInWarehouse: number;
    bottlesOnShelfAndMarket: number;
    totalCrates: number;
    emptyValueKobo: string | null;
    products: ProductOverviewDto[];
  }>;
  warnings: {
    productsWithoutBrewery: Array<{ productId: string; productName: string; totalUnits: number }>;
    assignedCans: Array<{ productId: string; productName: string; ownerId?: string }>;
    productsAssignedToInactiveOwner: Array<{ productId: string; productName: string; ownerId?: string }>;
  };
}

interface ApiError {
  error: { code: string; message: string; details: unknown };
}

/** Labels are capped at 40 characters by `ck_empties_types_label`. */
const uniqueLabel = (): string => newId("lbl").slice(0, 40);

async function createOwner(name = `Owner ${newId("empties")}`): Promise<OwnerDto> {
  const response = await h.app.inject({
    method: "POST",
    url: "/empties/owners",
    payload: { name },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<OwnerDto>();
}

async function createType(input: {
  ownerId: string;
  kind?: "BOTTLE" | "CRATE";
  label?: string;
  capacity?: number | null;
  unitValueKobo?: string | null;
}): Promise<TypeDto> {
  const response = await h.app.inject({
    method: "POST",
    url: "/empties/types",
    payload: {
      ownerId: input.ownerId,
      kind: input.kind ?? "BOTTLE",
      label: input.label ?? uniqueLabel(),
      ...(input.capacity === undefined ? {} : { capacity: input.capacity }),
      ...(input.unitValueKobo === undefined ? {} : { unitValueKobo: input.unitValueKobo }),
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<TypeDto>();
}

function record(
  typeId: string,
  movementType: MovementDto["movementType"],
  quantity: number,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return h.app.inject({
    method: "POST",
    url: "/empties/movements",
    payload: { typeId, movementType, quantity, ...extra },
    headers,
  });
}

async function balanceOf(typeId: string): Promise<number> {
  const { rows } = await h.pg.query<{ n: number }>(
    `SELECT COALESCE(quantity, 0)::int AS n FROM empties_balances WHERE "typeId" = $1`,
    [typeId],
  );
  return rows[0]?.n ?? 0;
}

async function movementCountOf(typeId: string): Promise<number> {
  const { rows } = await h.pg.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM empties_movements WHERE "typeId" = $1`,
    [typeId],
  );
  return Number(rows[0]!.n);
}

async function addStockUnits(
  productId: string,
  location: "WAREHOUSE" | "RETAIL_SHELF" | "MARKET",
  quantityUnits: number,
): Promise<void> {
  await h.pg.query(
    `INSERT INTO stock_movements
       (id, "productId", location, type, "quantityUnits", "unitCostKobo", "returnLineId")
     VALUES ($1, $2, $3::"StockLocation", 'PURCHASE', $4, 0::bigint, $5)`,
    [newId("empties_stock"), productId, location, quantityUnits, newId("empties_stock_source")],
  );
}

async function setProductOwner(productId: string, ownerId: string | null, key?: string) {
  return h.app.inject({
    method: "PUT",
    url: `/empties/product-owners/${productId}`,
    payload: { ownerId },
    headers: key === undefined ? {} : { "idempotency-key": key },
  });
}

describe("purchase container product setup", () => {
  it("creates a bottle type with its explicit crate capacity", async () => {
    const owner = await createOwner();
    const type = await createType({ ownerId: owner.id, kind: "BOTTLE", capacity: 12 });
    expect(type).toMatchObject({ kind: "BOTTLE", capacity: 12 });
  });

  it("requires explicit confirmation and preserves crate and bottle types separately", async () => {
    const product = await seedProduct(h.pg);
    const owner = await createOwner();
    const crate = await createType({ ownerId: owner.id, kind: "CRATE" });
    const bottle = await createType({ ownerId: owner.id, kind: "BOTTLE" });
    expect((await setProductOwner(product.id, owner.id)).statusCode).toBe(200);
    const saleSettings = await h.app.inject({
      method: "PUT",
      url: `/empties/products/${product.id}/packaging`,
      payload: { mappings: [{ kind: "CRATE", typeId: crate.id, retailQuantityPerUnit: 0, wholesaleQuantityPerPack: 1 }] },
    });
    expect(saleSettings.statusCode, saleSettings.body).toBe(200);

    const listing = await h.app.inject({
      method: "GET",
      url: `/empties/purchase-setup?limit=200&cursor=${encodeURIComponent(product.id.slice(0, -1))}`,
    });
    expect(listing.statusCode, listing.body).toBe(200);
    const page = listing.json<{ items: Array<{
      productId: string;
      classification: string | null;
      mappings: unknown[];
      salePackagingSuggestions: Array<{ typeId: string }>;
    }>; nextCursor: string | null }>();
    const item = page.items.find((row) => row.productId === product.id);
    expect(item).toMatchObject({
      classification: "NON_RETURNABLE",
      mappings: [],
      salePackagingSuggestions: [expect.objectContaining({ typeId: crate.id })],
    });
    const payload = {
      classification: "RETURNABLE",
      mappings: [
        { kind: "CRATE", typeId: crate.id, countPerPack: 1 },
        { kind: "BOTTLE", typeId: bottle.id, countPerUnit: 1 },
      ],
    };
    const key = newId("purchase_setup_key");
    const save = () => h.app.inject({
      method: "PUT", url: `/empties/products/${product.id}/purchase-setup`,
      payload, headers: { "idempotency-key": key },
    });
    const first = await save();
    expect(first.statusCode, first.body).toBe(200);
    const replay = await save();
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    const rows = await h.pg.query(
      `SELECT kind, "typeId", "countPerPack", "countPerUnit"
         FROM purchase_empties_packaging WHERE "productId" = $1 ORDER BY kind`,
      [product.id],
    );
    expect(rows.rows).toEqual([
      { kind: "BOTTLE", typeId: bottle.id, countPerPack: null, countPerUnit: 1 },
      { kind: "CRATE", typeId: crate.id, countPerPack: 1, countPerUnit: null },
    ]);

    const refused = await setProductOwner(product.id, null);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<ApiError>().error.message).toContain("purchase container setup");
    const clear = await h.app.inject({
      method: "PUT", url: `/empties/products/${product.id}/purchase-setup`,
      payload: { classification: "RETURNABLE", mappings: [] },
    });
    expect(clear.statusCode, clear.body).toBe(200);
    expect((await setProductOwner(product.id, null)).statusCode).toBe(200);
  }, 90_000);

  it("rejects wrong brewery, wrong kind, duplicate kinds and non-returnable mappings", async () => {
    const product = await seedProduct(h.pg);
    const owner = await createOwner();
    const otherOwner = await createOwner();
    const crate = await createType({ ownerId: owner.id, kind: "CRATE" });
    const otherCrate = await createType({ ownerId: otherOwner.id, kind: "CRATE" });
    expect((await setProductOwner(product.id, owner.id)).statusCode).toBe(200);
    const mapping = { kind: "CRATE", typeId: crate.id, countPerPack: 1 };
    for (const payload of [
      { classification: "RETURNABLE", mappings: [{ ...mapping, typeId: otherCrate.id }] },
      { classification: "RETURNABLE", mappings: [{ kind: "BOTTLE", typeId: crate.id, countPerUnit: 1 }] },
      { classification: "RETURNABLE", mappings: [mapping, mapping] },
      { classification: "NON_RETURNABLE", mappings: [mapping] },
    ]) {
      const response = await h.app.inject({
        method: "PUT", url: `/empties/products/${product.id}/purchase-setup`, payload,
      });
      expect(response.statusCode, response.body).toBe(400);
    }
    const result = await h.pg.query(
      `SELECT classification FROM purchase_empties_products WHERE "productId" = $1`,
      [product.id],
    );
    expect(result.rows[0].classification).toBe("NON_RETURNABLE");
  }, 90_000);
});

describe("opening supplier empties debt", () => {
  it("records one idempotent, separately listed obligation without changing stock or money", async () => {
    const owner = await createOwner();
    const crate = await createType({ ownerId: owner.id, kind: "CRATE" });
    const supplier = await seedSupplier(h.pg);
    const key = newId("opening_empties_key");
    const payload = { supplierId: supplier.id, typeId: crate.id, quantity: 5, note: "Counted existing debt" };
    const save = () => h.app.inject({
      method: "POST",
      url: "/empties/supplier-debts/opening",
      payload,
      headers: { "idempotency-key": key },
    });
    const first = await save();
    expect(first.statusCode, first.body).toBe(201);
    const replay = await save();
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(replay.json()).toEqual(first.json());
    const id = first.json<{ id: string }>().id;
    const listed = await h.app.inject({
      method: "GET", url: `/empties/supplier-debts?supplierId=${encodeURIComponent(supplier.id)}`,
    });
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json<{ items: unknown[] }>().items).toContainEqual(expect.objectContaining({
      id, supplierId: supplier.id, typeId: crate.id, kind: "CRATE", purchaseId: null,
      originalQuantity: 5, quantity: 5,
    }));
    const result = await h.pg.query<{ events: string; money: string; movements: string }>(
      `SELECT
         (SELECT count(*) FROM supplier_empties_events WHERE "obligationId" = $1)::text AS events,
         (SELECT count(*) FROM supplier_ledger_entries WHERE "supplierId" = $2)::text AS money,
         (SELECT count(*) FROM empties_movements WHERE "typeId" = $3)::text AS movements`,
      [id, supplier.id, crate.id],
    );
    expect(result.rows[0]).toEqual({ events: "1", money: "0", movements: "0" });
    const invalid = await h.app.inject({
      method: "POST", url: "/empties/supplier-debts/opening", payload: { ...payload, quantity: 0 },
    });
    expect(invalid.statusCode).toBe(400);
  }, 90_000);
});

describe("supplier empties settlements", () => {
  it("serializes two settlements competing for the last empty", async () => {
    const owner = await createOwner();
    const crate = await createType({ ownerId: owner.id, kind: "CRATE" });
    const supplier = await seedSupplier(h.pg);
    expect((await record(crate.id, "OPENING", 1)).statusCode).toBe(201);
    const opening = await h.app.inject({
      method: "POST", url: "/empties/supplier-debts/opening",
      payload: { supplierId: supplier.id, typeId: crate.id, quantity: 2, note: "Counted debt" },
    });
    expect(opening.statusCode, opening.body).toBe(201);
    const settle = () => h.app.inject({
      method: "POST", url: "/empties/supplier-debts/settle",
      payload: { supplierId: supplier.id, typeId: crate.id, quantity: 1 },
    });
    const results = await Promise.all([settle(), settle()]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([201, 409]);
    expect(await balanceOf(crate.id)).toBe(0);
    const debt = await h.pg.query(
      `SELECT quantity FROM supplier_empties_obligation_balances WHERE "obligationId" = $1`,
      [opening.json<{ id: string }>().id],
    );
    expect(debt.rows).toEqual([{ quantity: 1 }]);
  }, 120_000);

  it("keeps opening debt and settlement out of financial position", async () => {
    const owner = await createOwner();
    const crate = await createType({ ownerId: owner.id, kind: "CRATE" });
    const supplier = await seedSupplier(h.pg);
    expect((await record(crate.id, "OPENING", 2)).statusCode).toBe(201);
    const before = await h.app.inject({ method: "GET", url: "/reports/financial-position?scenario=EXPECTED" });
    expect(before.statusCode, before.body).toBe(200);
    const opening = await h.app.inject({
      method: "POST", url: "/empties/supplier-debts/opening",
      payload: { supplierId: supplier.id, typeId: crate.id, quantity: 2, note: "Counted debt" },
    });
    expect(opening.statusCode, opening.body).toBe(201);
    const settle = await h.app.inject({
      method: "POST", url: "/empties/supplier-debts/settle",
      payload: { supplierId: supplier.id, typeId: crate.id, quantity: 1 },
    });
    expect(settle.statusCode, settle.body).toBe(201);
    const after = await h.app.inject({ method: "GET", url: "/reports/financial-position?scenario=EXPECTED" });
    expect(after.statusCode, after.body).toBe(200);
    expect(after.json<{ selected: unknown }>().selected).toEqual(before.json<{ selected: unknown }>().selected);
  }, 120_000);

  it("partly settles the oldest opening debts, retries safely, and refuses excess returns", async () => {
    const owner = await createOwner();
    const crate = await createType({ ownerId: owner.id, kind: "CRATE" });
    const supplier = await seedSupplier(h.pg);
    expect((await record(crate.id, "OPENING", 8)).statusCode).toBe(201);
    async function opening(quantity: number) {
      const response = await h.app.inject({
        method: "POST", url: "/empties/supplier-debts/opening",
        payload: { supplierId: supplier.id, typeId: crate.id, quantity, note: "Counted debt" },
      });
      expect(response.statusCode, response.body).toBe(201);
      return response.json<{ id: string }>().id;
    }
    const first = await opening(2);
    const second = await opening(4);
    const payload = { supplierId: supplier.id, typeId: crate.id, quantity: 3 };
    const key = newId("settle_empties_key");
    const settle = () => h.app.inject({
      method: "POST", url: "/empties/supplier-debts/settle",
      payload, headers: { "idempotency-key": key },
    });
    const result = await settle();
    expect(result.statusCode, result.body).toBe(201);
    expect(result.json<{ events: Array<{ obligationId: string; quantity: number }> }>().events)
      .toEqual([expect.objectContaining({ obligationId: first, quantity: 2 }), expect.objectContaining({ obligationId: second, quantity: 1 })]);
    const replay = await settle();
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(await balanceOf(crate.id)).toBe(5);
    const debts = await h.pg.query(
      `SELECT "obligationId", quantity FROM supplier_empties_obligation_balances
       WHERE "obligationId" = ANY($1::text[])`,
      [[first, second]],
    );
    expect(debts.rows).toContainEqual({ obligationId: first, quantity: 0 });
    expect(debts.rows).toContainEqual({ obligationId: second, quantity: 3 });
    const overDebt = await h.app.inject({
      method: "POST", url: "/empties/supplier-debts/settle",
      payload: { ...payload, quantity: 4 },
    });
    expect(overDebt.statusCode, overDebt.body).toBe(409);
    expect(overDebt.json<ApiError>().error.message).toContain("greater than the outstanding");
    const overStock = await h.app.inject({
      method: "POST", url: "/empties/supplier-debts/settle",
      payload: { ...payload, quantity: 6 },
    });
    expect(overStock.statusCode, overStock.body).toBe(409);
    expect(overStock.json<ApiError>().error.message).toContain("You have 5");
    expect(await balanceOf(crate.id)).toBe(5);
    const events = result.json<{ events: Array<{ eventId: string }> }>().events;
    const reversalKey = newId("settle_correction_key");
    const reverse = () => h.app.inject({
      method: "POST",
      url: `/empties/supplier-debts/settlements/${events[0]!.eventId}/reverse`,
      payload: { reason: "Wrong allocation" },
      headers: { "idempotency-key": reversalKey },
    });
    const corrected = await reverse();
    expect(corrected.statusCode, corrected.body).toBe(201);
    const retry = await reverse();
    expect(retry.statusCode, retry.body).toBe(201);
    expect(retry.headers["idempotent-replayed"]).toBe("true");
    expect(await balanceOf(crate.id)).toBe(7);
    const correctedBalance = await h.pg.query(
      `SELECT quantity FROM supplier_empties_obligation_balances WHERE "obligationId" = $1`, [first],
    );
    expect(correctedBalance.rows[0].quantity).toBe(2);
    const duplicate = await h.app.inject({
      method: "POST",
      url: `/empties/supplier-debts/settlements/${events[0]!.eventId}/reverse`,
      payload: { reason: "Duplicate correction" },
    });
    expect(duplicate.statusCode, duplicate.body).toBe(409);
    const history = await h.app.inject({
      method: "GET", url: `/empties/supplier-debts/settlements?supplierId=${encodeURIComponent(supplier.id)}`,
    });
    expect(history.statusCode, history.body).toBe(200);
    expect(history.json<{ items: unknown[] }>().items).toContainEqual(
      expect.objectContaining({ id: events[0]!.eventId, reversed: true, quantity: 2 }),
    );
    const selected = await h.app.inject({
      method: "POST", url: "/empties/supplier-debts/settle",
      payload: { supplierId: supplier.id, typeId: crate.id, quantity: 2,
        allocations: [{ obligationId: second, quantity: 2 }] },
    });
    expect(selected.statusCode, selected.body).toBe(201);
    expect(selected.json<{ events: unknown[] }>().events).toEqual([
      expect.objectContaining({ obligationId: second, quantity: 2 }),
    ]);
    const selectedBalances = await h.pg.query(
      `SELECT "obligationId", quantity FROM supplier_empties_obligation_balances WHERE "obligationId" = ANY($1::text[])`,
      [[first, second]],
    );
    expect(selectedBalances.rows).toContainEqual({ obligationId: first, quantity: 2 });
    expect(selectedBalances.rows).toContainEqual({ obligationId: second, quantity: 1 });
  }, 120_000);
});

describe("purchase container receipt", () => {
  it("enforces receipt checks on the installed migration in either draft order and for 50 lines", async () => {
    const product = await seedProduct(h.pg, { unitsPerPack: 12 });
    const owner = await createOwner();
    const crate = await createType({ ownerId: owner.id, kind: "CRATE" });
    const supplier = await seedSupplier(h.pg);
    expect((await setProductOwner(product.id, owner.id)).statusCode).toBe(200);
    const setup = await h.app.inject({
      method: "PUT", url: `/empties/products/${product.id}/purchase-setup`,
      payload: { classification: "RETURNABLE", mappings: [{ kind: "CRATE", typeId: crate.id, countPerPack: 1 }] },
    });
    expect(setup.statusCode, setup.body).toBe(200);
    expect((await record(crate.id, "OPENING", 53)).statusCode).toBe(201);

    async function receiveDraft(count: number, checkFirst: boolean, persistDraft = false) {
      const purchaseId = newId("draft_receipt");
      await h.pg.query("BEGIN");
      try {
        await h.pg.query(
          `INSERT INTO purchases (id, "createdById", "supplierId", status, "totalKobo", "paidKobo", "updatedAt")
           VALUES ($1, $2, $3, 'DRAFT', 0, 0, now())`,
          [purchaseId, h.actor.id, supplier.id],
        );
        if (persistDraft) {
          await h.pg.query("COMMIT");
          await h.pg.query("BEGIN");
        }
        await h.pg.query(
          `INSERT INTO purchase_lines (id, "purchaseId", "productId", unit, quantity, "unitsPerPackSnapshot", "quantityUnits", "unitCostKobo", "lineTotalKobo")
           SELECT $1 || '_line_' || n, $1, $2, 'PACK', 1, 12, 12, 0, 0 FROM generate_series(1, $3::int) n`,
          [purchaseId, product.id, count],
        );
        await h.pg.query(
          `INSERT INTO purchase_empties_line_snapshots ("purchaseLineId", classification)
           SELECT id, 'RETURNABLE' FROM purchase_lines WHERE "purchaseId" = $1`, [purchaseId],
        );
        await h.pg.query(
          `INSERT INTO purchase_empties_requirements ("purchaseLineId", "typeId", kind, quantity, "countPerPackSnapshot")
           SELECT id, $2, 'CRATE', 1, 1 FROM purchase_lines WHERE "purchaseId" = $1`, [purchaseId, crate.id],
        );
        const check = () => h.pg.query(
          `INSERT INTO purchase_empties_checks ("purchaseId", "typeId", "availableQuantity", "capturedTxid")
           VALUES ($1, $2, 0, 0)`, [purchaseId, crate.id],
        );
        if (checkFirst) await check();
        await h.pg.query(`UPDATE purchases SET status = 'RECEIVED' WHERE id = $1`, [purchaseId]);
        if (!checkFirst) await check();
        await h.pg.query(
          `INSERT INTO stock_movements (id, "productId", location, type, "quantityUnits", "unitCostKobo", "purchaseLineId")
           SELECT id || '_stock', $2, 'WAREHOUSE', 'PURCHASE', 12, 0, id
           FROM purchase_lines WHERE "purchaseId" = $1`, [purchaseId, product.id],
        );
        const eventId = newId("draft_return");
        await h.pg.query(
          `INSERT INTO supplier_empties_events (id, "eventType", "typeId", "purchaseId", quantity, "createdById")
           VALUES ($1, 'RETURNED_FOR_PURCHASE', $2, $3, -$4::int, $5)`,
          [eventId, crate.id, purchaseId, count, h.actor.id],
        );
        await h.pg.query(
          `INSERT INTO empties_movements (id, "typeId", "movementType", quantity, "createdById", "supplierEmptiesEventId")
           VALUES ($1, $2, 'RETURNED_TO_OWNER', -$3::int, $4, $5)`,
          [newId("draft_movement"), crate.id, count, h.actor.id, eventId],
        );
        const start = performance.now();
        await h.pg.query("SET CONSTRAINTS ALL IMMEDIATE");
        if (count === 50) console.log(`50-line installed migration deferred checks: ${Math.round(performance.now() - start)} ms`);
        await h.pg.query("COMMIT");
      } catch (error) {
        await h.pg.query("ROLLBACK");
        throw error;
      }
      const persisted = await h.pg.query(`SELECT status FROM purchases WHERE id = $1`, [purchaseId]);
      expect(persisted.rows).toEqual([{ status: "RECEIVED" }]);
    }

    await receiveDraft(1, true);
    await receiveDraft(1, false);
    await receiveDraft(50, false);
    await receiveDraft(1, false, true);
    expect(await balanceOf(crate.id)).toBe(0);

    const oldPurchase = newId("old_api_purchase");
    await h.pg.query("BEGIN");
    try {
      await h.pg.query(
        `INSERT INTO purchases (id, "createdById", "supplierId", status, "totalKobo", "paidKobo", "updatedAt")
         VALUES ($1, $2, $3, 'RECEIVED', 0, 0, now())`, [oldPurchase, h.actor.id, supplier.id],
      );
      await h.pg.query(
        `INSERT INTO purchase_lines (id, "purchaseId", "productId", unit, quantity, "unitsPerPackSnapshot", "quantityUnits", "unitCostKobo", "lineTotalKobo")
         VALUES ($1, $2, $3, 'PACK', 1, 12, 12, 0, 0)`, [newId("old_line"), oldPurchase, product.id],
      );
      await expect(h.pg.query("SET CONSTRAINTS ALL IMMEDIATE")).rejects.toThrow(/empties classification/i);
    } finally {
      await h.pg.query("ROLLBACK");
    }
    const rejected = await h.pg.query(`SELECT id FROM purchases WHERE id = $1`, [oldPurchase]);
    expect(rejected.rows).toEqual([]);
  }, 240_000);

  it("requires the exact split shortage and records physical returns, gifts and debt separately", async () => {
    const product = await seedProduct(h.pg, { unitsPerPack: 12 });
    const owner = await createOwner();
    const crate = await createType({ ownerId: owner.id, kind: "CRATE" });
    const supplier = await seedSupplier(h.pg);
    expect((await setProductOwner(product.id, owner.id)).statusCode).toBe(200);
    const setup = await h.app.inject({
      method: "PUT", url: `/empties/products/${product.id}/purchase-setup`,
      payload: { classification: "RETURNABLE", mappings: [{ kind: "CRATE", typeId: crate.id, countPerPack: 1 }] },
    });
    expect(setup.statusCode, setup.body).toBe(200);
    expect((await record(crate.id, "OPENING", 75)).statusCode).toBe(201);
    const preview = await h.app.inject({
      method: "POST", url: "/purchases/empties-preview",
      payload: { lines: [{ productId: product.id, unit: "PACK", quantity: 80 }] },
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json<{ totals: unknown[] }>().totals).toContainEqual(expect.objectContaining({
      typeId: crate.id, required: 80, available: 75, shortage: 5,
    }));
    const body = purchaseBody({ productId: product.id, unit: "PACK", quantity: 80, supplierId: supplier.id });
    const unresolved = await h.app.inject({ method: "POST", url: "/purchases", payload: body });
    expect(unresolved.statusCode, unresolved.body).toBe(409);
    expect(unresolved.json<ApiError>().error.message).toContain("Short by 5");
    expect(await balanceOf(crate.id)).toBe(75);
    const key = newId("purchase_split_key");
    const payload = { ...body, emptiesResolutions: [{ typeId: crate.id, suppliedFree: 2, owed: 3 }] };
    expect((await record(crate.id, "RECEIVED", 1)).statusCode).toBe(201);
    const stale = await h.app.inject({ method: "POST", url: "/purchases", payload });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json<ApiError>().error.message).toContain("Short by 4");
    expect((await record(crate.id, "RETURNED_TO_OWNER", 1)).statusCode).toBe(201);
    const save = () => h.app.inject({
      method: "POST", url: "/purchases", payload, headers: { "idempotency-key": key },
    });
    const received = await save();
    expect(received.statusCode, received.body).toBe(201);
    const retry = await save();
    expect(retry.statusCode, retry.body).toBe(201);
    expect(retry.headers["idempotent-replayed"]).toBe("true");
    const purchaseId = received.json<{ id: string }>().id;
    const events = await h.pg.query(
      `SELECT "eventType", quantity FROM supplier_empties_events
       WHERE "purchaseId" = $1 ORDER BY "eventType"`, [purchaseId],
    );
    expect(events.rows).toEqual([
      { eventType: "RETURNED_FOR_PURCHASE", quantity: -75 },
      { eventType: "SUPPLIED_FREE", quantity: 2 },
      { eventType: "PURCHASE_DEBT", quantity: 3 },
    ]);
    expect(await balanceOf(crate.id)).toBe(0);
    const debts = await h.pg.query(
      `SELECT b.quantity FROM supplier_empties_obligations o
       JOIN supplier_empties_obligation_balances b ON b."obligationId" = o.id WHERE o."purchaseId" = $1`,
      [purchaseId],
    );
    expect(debts.rows).toEqual([{ quantity: 3 }]);
    const detail = await h.app.inject({ method: "GET", url: `/purchases/${purchaseId}` });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json<{ empties: { debts: unknown[] } }>().empties.debts).toContainEqual(
      expect.objectContaining({ typeId: crate.id, quantity: 3 }),
    );
    const purchaseMovement = await h.pg.query(
      `SELECT m.id FROM empties_movements m JOIN supplier_empties_events e ON e.id = m."supplierEmptiesEventId"
       WHERE e."purchaseId" = $1 AND e."eventType" = 'RETURNED_FOR_PURCHASE'`, [purchaseId],
    );
    const independentReversal = await h.app.inject({
      method: "POST", url: `/empties/movements/${purchaseMovement.rows[0].id}/reverse`,
      payload: { reason: "Wrong action" },
    });
    expect(independentReversal.statusCode, independentReversal.body).toBe(409);
    expect(independentReversal.json<ApiError>().error.message).toContain("belongs to a purchase");
    expect((await record(crate.id, "RECEIVED", 3)).statusCode).toBe(201);
    const settlement = await h.app.inject({
      method: "POST", url: "/empties/supplier-debts/settle",
      payload: { supplierId: supplier.id, typeId: crate.id, quantity: 1 },
    });
    expect(settlement.statusCode, settlement.body).toBe(201);
    const blocked = await h.app.inject({ method: "POST", url: `/purchases/${purchaseId}/void` });
    expect(blocked.statusCode, blocked.body).toBe(409);
    expect(blocked.json<ApiError>().error.message).toContain("Correct the linked empties settlements");
    const blockedPreview = await h.app.inject({
      method: "POST", url: "/purchases/empties-preview",
      payload: { amendingPurchaseId: purchaseId, lines: [{ productId: product.id, unit: "PACK", quantity: 1 }] },
    });
    expect(blockedPreview.statusCode, blockedPreview.body).toBe(409);
    expect(blockedPreview.json<ApiError>().error.message).toContain("Correct the linked empties settlements");
    const settlementId = settlement.json<{ events: Array<{ eventId: string }> }>().events[0]!.eventId;
    const correction = await h.app.inject({
      method: "POST", url: `/empties/supplier-debts/settlements/${settlementId}/reverse`,
      payload: { reason: "Correct before void" },
    });
    expect(correction.statusCode, correction.body).toBe(201);
    const voided = await h.app.inject({ method: "POST", url: `/purchases/${purchaseId}/void` });
    expect(voided.statusCode, voided.body).toBe(200);
    expect(await balanceOf(crate.id)).toBe(78);
    const debtAfterVoid = await h.pg.query(
      `SELECT b.quantity FROM supplier_empties_obligations o
       JOIN supplier_empties_obligation_balances b ON b."obligationId" = o.id WHERE o."purchaseId" = $1`,
      [purchaseId],
    );
    expect(debtAfterVoid.rows).toEqual([{ quantity: 0 }]);
  }, 180_000);

  it("aggregates compatible products and checks crates and bottles independently", async () => {
    const first = await seedProduct(h.pg, { unitsPerPack: 12 });
    const second = await seedProduct(h.pg, { unitsPerPack: 12 });
    const owner = await createOwner();
    const crate = await createType({ ownerId: owner.id, kind: "CRATE" });
    const bottle = await createType({ ownerId: owner.id, kind: "BOTTLE" });
    const supplier = await seedSupplier(h.pg);
    for (const product of [first, second]) {
      expect((await setProductOwner(product.id, owner.id)).statusCode).toBe(200);
      const setup = await h.app.inject({
        method: "PUT", url: `/empties/products/${product.id}/purchase-setup`,
        payload: { classification: "RETURNABLE", mappings: [
          { kind: "CRATE", typeId: crate.id, countPerPack: 1 },
          { kind: "BOTTLE", typeId: bottle.id, countPerUnit: 1 },
        ] },
      });
      expect(setup.statusCode, setup.body).toBe(200);
    }
    expect((await record(crate.id, "OPENING", 2)).statusCode).toBe(201);
    expect((await record(bottle.id, "OPENING", 24)).statusCode).toBe(201);
    const body = purchaseBody({
      supplierId: supplier.id,
      lines: [
        { productId: first.id, unit: "PACK", quantity: 1, lineTotalKobo: "1000" },
        { productId: second.id, unit: "PACK", quantity: 1, lineTotalKobo: "1000" },
      ],
    });
    const received = await h.app.inject({ method: "POST", url: "/purchases", payload: body });
    expect(received.statusCode, received.body).toBe(201);
    expect(await balanceOf(crate.id)).toBe(0);
    expect(await balanceOf(bottle.id)).toBe(0);
    const purchaseId = received.json<{ id: string }>().id;
    const checks = await h.pg.query(
      `SELECT "typeId", "availableQuantity" FROM purchase_empties_checks WHERE "purchaseId" = $1`,
      [purchaseId],
    );
    expect(checks.rows).toHaveLength(2);
    expect(checks.rows).toContainEqual({ typeId: crate.id, availableQuantity: 2 });
    expect(checks.rows).toContainEqual({ typeId: bottle.id, availableQuantity: 24 });
  }, 180_000);

  it("requires a whole crate count for partial packs and defaults single-unit crate count to zero", async () => {
    const product = await seedProduct(h.pg, { unitsPerPack: 12 });
    const owner = await createOwner();
    const crate = await createType({ ownerId: owner.id, kind: "CRATE" });
    const supplier = await seedSupplier(h.pg);
    expect((await setProductOwner(product.id, owner.id)).statusCode).toBe(200);
    const setup = await h.app.inject({
      method: "PUT", url: `/empties/products/${product.id}/purchase-setup`,
      payload: { classification: "RETURNABLE", mappings: [{ kind: "CRATE", typeId: crate.id, countPerPack: 1 }] },
    });
    expect(setup.statusCode, setup.body).toBe(200);
    expect((await record(crate.id, "OPENING", 1)).statusCode).toBe(201);
    const partial = purchaseBody({ productId: product.id, unit: "PACK", quantity: 0.5, supplierId: supplier.id });
    const rejected = await h.app.inject({ method: "POST", url: "/purchases", payload: partial });
    expect(rejected.statusCode, rejected.body).toBe(400);
    expect(rejected.json<ApiError>().error.message).toContain("whole crates");
    const lines = partial.lines as Array<Record<string, unknown>>;
    const received = await h.app.inject({
      method: "POST", url: "/purchases", payload: { ...partial, lines: [{ ...lines[0], emptiesCrateCount: 1 }] },
    });
    expect(received.statusCode, received.body).toBe(201);
    expect(await balanceOf(crate.id)).toBe(0);
    const single = await h.app.inject({
      method: "POST", url: "/purchases",
      payload: purchaseBody({ productId: product.id, unit: "UNIT", quantity: 1, supplierId: supplier.id }),
    });
    expect(single.statusCode, single.body).toBe(201);
    const requirements = await h.pg.query(
      `SELECT r.quantity, r."manualCrateCount"
       FROM purchase_empties_requirements r JOIN purchase_lines l ON l.id = r."purchaseLineId"
       WHERE l."purchaseId" = $1`, [single.json<{ id: string }>().id],
    );
    expect(requirements.rows).toEqual([{ quantity: 0, manualCrateCount: true }]);
  }, 180_000);

  it("serializes two purchases competing for the last compatible crate", async () => {
    const products = await Promise.all([
      seedProduct(h.pg, { unitsPerPack: 12 }),
      seedProduct(h.pg, { unitsPerPack: 12 }),
    ]);
    const owner = await createOwner();
    const crate = await createType({ ownerId: owner.id, kind: "CRATE" });
    const supplier = await seedSupplier(h.pg);
    for (const product of products) {
      expect((await setProductOwner(product.id, owner.id)).statusCode).toBe(200);
      const setup = await h.app.inject({
        method: "PUT", url: `/empties/products/${product.id}/purchase-setup`,
        payload: { classification: "RETURNABLE", mappings: [{ kind: "CRATE", typeId: crate.id, countPerPack: 1 }] },
      });
      expect(setup.statusCode, setup.body).toBe(200);
    }
    expect((await record(crate.id, "OPENING", 1)).statusCode).toBe(201);
    const results = await Promise.all(products.map((product) => h.app.inject({
      method: "POST", url: "/purchases",
      payload: purchaseBody({ productId: product.id, unit: "PACK", quantity: 1, supplierId: supplier.id }),
    })));
    expect(results.map((result) => result.statusCode).sort()).toEqual([201, 409]);
    expect(await balanceOf(crate.id)).toBe(0);
  }, 180_000);

  it("serializes two purchases and a settlement competing for the last crate", async () => {
    const products = await Promise.all([
      seedProduct(h.pg, { unitsPerPack: 12 }),
      seedProduct(h.pg, { unitsPerPack: 12 }),
    ]);
    const owner = await createOwner();
    const crate = await createType({ ownerId: owner.id, kind: "CRATE" });
    const supplier = await seedSupplier(h.pg);
    for (const product of products) {
      expect((await setProductOwner(product.id, owner.id)).statusCode).toBe(200);
      const setup = await h.app.inject({
        method: "PUT", url: `/empties/products/${product.id}/purchase-setup`,
        payload: { classification: "RETURNABLE", mappings: [{ kind: "CRATE", typeId: crate.id, countPerPack: 1 }] },
      });
      expect(setup.statusCode, setup.body).toBe(200);
    }
    expect((await record(crate.id, "OPENING", 1)).statusCode).toBe(201);
    const opening = await h.app.inject({
      method: "POST", url: "/empties/supplier-debts/opening",
      payload: { supplierId: supplier.id, typeId: crate.id, quantity: 1, note: "Counted debt" },
    });
    expect(opening.statusCode, opening.body).toBe(201);
    const results = await Promise.all([
      ...products.map((product) => h.app.inject({
        method: "POST", url: "/purchases",
        payload: purchaseBody({ productId: product.id, unit: "PACK", quantity: 1, supplierId: supplier.id }),
      })),
      h.app.inject({
        method: "POST", url: "/empties/supplier-debts/settle",
        payload: { supplierId: supplier.id, typeId: crate.id, quantity: 1 },
      }),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([201, 409, 409]);
    expect(await balanceOf(crate.id)).toBe(0);
  }, 180_000);

  it("retries a real database deadlock as a whole transaction", async () => {
    const first = await seedProduct(h.pg);
    const second = await seedProduct(h.pg);
    const log: Array<Record<string, unknown>> = [];
    const runner = createWriteRunner({
      prisma: h.prisma,
      now: () => new Date(),
      log: (entry) => log.push(entry),
      txTimeouts: { timeoutMs: 30_000, maxWaitMs: 15_000, lockTimeoutMs: 20_000 },
    });
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const run = (left: string, right: string) => {
      let attempts = 0;
      return runner.runWrite("test deadlock retry", {}, async ({ tx }) => {
        attempts += 1;
        await tx.$queryRaw`SELECT id FROM products WHERE id = ${left} FOR UPDATE`;
        if (attempts === 1) {
          arrivals += 1;
          if (arrivals === 2) release();
          await barrier;
        }
        await tx.$queryRaw`SELECT id FROM products WHERE id = ${right} FOR UPDATE`;
        return { status: 200, body: {}, replayed: false };
      });
    };
    const results = await Promise.all([run(first.id, second.id), run(second.id, first.id)]);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(log.some((entry) => typeof entry.retry === "number")).toBe(true);
  }, 120_000);

  it("blocks missing setup and permits a free shortage without a supplier", async () => {
    const product = await seedProduct(h.pg, { unitsPerPack: 12 });
    const owner = await createOwner();
    const crate = await createType({ ownerId: owner.id, kind: "CRATE" });
    expect((await setProductOwner(product.id, owner.id)).statusCode).toBe(200);
    const url = `/empties/products/${product.id}/purchase-setup`;
    const unset = await h.app.inject({
      method: "PUT", url, payload: { classification: "RETURNABLE", mappings: [] },
    });
    expect(unset.statusCode, unset.body).toBe(200);
    const payload = purchaseBody({ productId: product.id, unit: "PACK", quantity: 2, lineTotalKobo: "0" });
    const blocked = await h.app.inject({ method: "POST", url: "/purchases", payload });
    expect(blocked.statusCode, blocked.body).toBe(409);
    expect(blocked.json<ApiError>().error.message).toContain("Purchase empties setup");
    const setup = await h.app.inject({
      method: "PUT", url,
      payload: { classification: "RETURNABLE", mappings: [{ kind: "CRATE", typeId: crate.id, countPerPack: 1 }] },
    });
    expect(setup.statusCode, setup.body).toBe(200);
    const owe = await h.app.inject({
      method: "POST", url: "/purchases",
      payload: { ...payload, emptiesResolutions: [{ typeId: crate.id, suppliedFree: 0, owed: 2 }] },
    });
    expect(owe.statusCode, owe.body).toBe(400);
    const gift = await h.app.inject({
      method: "POST", url: "/purchases",
      payload: { ...payload, emptiesResolutions: [{ typeId: crate.id, suppliedFree: 2, owed: 0 }] },
    });
    expect(gift.statusCode, gift.body).toBe(201);
    expect(await balanceOf(crate.id)).toBe(0);
    const events = await h.pg.query(
      `SELECT "eventType", quantity FROM supplier_empties_events WHERE "purchaseId" = $1`,
      [gift.json<{ id: string }>().id],
    );
    expect(events.rows).toEqual([{ eventType: "SUPPLIED_FREE", quantity: 2 }]);
  }, 180_000);

  it("recalculates an amended purchase after returning the original empties", async () => {
    const product = await seedProduct(h.pg, { unitsPerPack: 12 });
    const owner = await createOwner();
    const crate = await createType({ ownerId: owner.id, kind: "CRATE" });
    const supplier = await seedSupplier(h.pg);
    expect((await setProductOwner(product.id, owner.id)).statusCode).toBe(200);
    const setup = await h.app.inject({
      method: "PUT", url: `/empties/products/${product.id}/purchase-setup`,
      payload: { classification: "RETURNABLE", mappings: [{ kind: "CRATE", typeId: crate.id, countPerPack: 1 }] },
    });
    expect(setup.statusCode, setup.body).toBe(200);
    expect((await record(crate.id, "OPENING", 2)).statusCode).toBe(201);
    const first = await h.app.inject({
      method: "POST", url: "/purchases",
      payload: purchaseBody({ productId: product.id, unit: "PACK", quantity: 2, supplierId: supplier.id }),
    });
    expect(first.statusCode, first.body).toBe(201);
    expect(await balanceOf(crate.id)).toBe(0);
    const purchaseId = first.json<{ id: string }>().id;
    const preview = await h.app.inject({
      method: "POST", url: "/purchases/empties-preview",
      payload: { amendingPurchaseId: purchaseId, lines: [{ productId: product.id, unit: "PACK", quantity: 1 }] },
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json<{ totals: unknown[] }>().totals).toContainEqual(
      expect.objectContaining({ typeId: crate.id, required: 1, available: 2, shortage: 0 }),
    );
    const amended = await h.app.inject({
      method: "PUT", url: `/purchases/${purchaseId}`,
      payload: purchaseBody({ productId: product.id, unit: "PACK", quantity: 1, supplierId: supplier.id }),
    });
    expect(amended.statusCode, amended.body).toBe(200);
    expect(await balanceOf(crate.id)).toBe(1);
    const old = await h.pg.query(`SELECT status FROM purchases WHERE id = $1`, [purchaseId]);
    expect(old.rows[0].status).toBe("VOIDED");
    const replacementId = amended.json<{ purchase: { id: string } }>().purchase.id;
    const check = await h.pg.query(
      `SELECT "availableQuantity" FROM purchase_empties_checks WHERE "purchaseId" = $1 AND "typeId" = $2`,
      [replacementId, crate.id],
    );
    expect(check.rows).toEqual([{ availableQuantity: 2 }]);
  }, 180_000);
});

describe("empties movements update the derived balance", () => {
  it("warns that a manual brewery return does not settle supplier empties debt", async () => {
    const owner = await createOwner();
    const crate = await createType({ ownerId: owner.id, kind: "CRATE" });
    const supplier = await seedSupplier(h.pg);
    const obligationId = newId("opening_empties_debt");
    await record(crate.id, "OPENING", 3);
    await h.pg.query("BEGIN");
    try {
      await h.pg.query(
        `INSERT INTO supplier_empties_obligations (id, "supplierId", "typeId", "createdById")
         VALUES ($1, $2, $3, $4)`,
        [obligationId, supplier.id, crate.id, h.actor.id],
      );
      await h.pg.query(
        `INSERT INTO supplier_empties_events (id, "eventType", "typeId", "obligationId", quantity, note, "createdById")
         VALUES ($1, 'OPENING_DEBT', $2, $3, 2, 'Existing debt', $4)`,
        [newId("opening_debt_event"), crate.id, obligationId, h.actor.id],
      );
      await h.pg.query("COMMIT");
    } catch (error) {
      await h.pg.query("ROLLBACK");
      throw error;
    }
    const response = await record(crate.id, "RETURNED_TO_OWNER", 1);
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json<{ warning: string }>().warning).toContain("did not settle supplier empties debt");
    const balance = await h.pg.query(
      `SELECT quantity FROM supplier_empties_obligation_balances WHERE "obligationId" = $1`,
      [obligationId],
    );
    expect(balance.rows[0].quantity).toBe(2);
    expect(await balanceOf(crate.id)).toBe(2);
  }, 90_000);

  it("keeps bottle and crate owner totals separate on both balance endpoints", async () => {
    const owner = await createOwner();
    const crate = await createType({ ownerId: owner.id, kind: "CRATE" });
    const bottle = await createType({ ownerId: owner.id, kind: "BOTTLE" });
    expect((await record(crate.id, "OPENING", 8)).statusCode).toBe(201);
    expect((await record(bottle.id, "OPENING", 20)).statusCode).toBe(201);
    const customer = await seedCustomer(h.pg);
    for (const [typeId, quantity] of [[crate.id, 3], [bottle.id, 7]] as const) {
      const result = await h.app.inject({
        method: "POST",
        url: "/empties/customer-movements",
        payload: { customerId: customer.id, typeId, movementType: "TAKEN", quantity },
      });
      expect(result.statusCode, result.body).toBe(201);
    }

    const onHand = await h.app.inject({ method: "GET", url: "/empties/balances" });
    expect(onHand.statusCode, onHand.body).toBe(200);
    const onHandTotals = onHand.json<BalancesDto>().totalsByOwner.filter((row) => row.ownerId === owner.id);
    expect(onHandTotals).toHaveLength(2);
    expect(onHandTotals).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "CRATE", quantity: 5 }),
        expect.objectContaining({ kind: "BOTTLE", quantity: 13 }),
      ]));
    const owed = await h.app.inject({
      method: "GET",
      url: `/empties/customer-balances?customerId=${customer.id}`,
    });
    expect(owed.statusCode, owed.body).toBe(200);
    const owedTotals = owed.json<BalancesDto>().totalsByOwner.filter((row) => row.ownerId === owner.id);
    expect(owedTotals).toHaveLength(2);
    expect(owedTotals).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "CRATE", quantity: 3 }),
        expect.objectContaining({ kind: "BOTTLE", quantity: 7 }),
      ]));
  }, 120_000);

  it("records every movement type with the right sign and keeps the balance in step", async () => {
    const owner = await createOwner();
    const type = await createType({ ownerId: owner.id, kind: "BOTTLE", unitValueKobo: "100" });

    const opening = await record(type.id, "OPENING", 12);
    expect(opening.statusCode, opening.body).toBe(201);
    expect(opening.json<MovementDto>().quantity).toBe(12);
    expect(await balanceOf(type.id)).toBe(12);
    console.log("STATEMENTS POST /empties/movements:", h.txLog.at(-1)?.queries);

    const received = await record(type.id, "RECEIVED", 5);
    expect(received.statusCode, received.body).toBe(201);
    expect(received.json<MovementDto>().quantity).toBe(5);
    expect(await balanceOf(type.id)).toBe(17);

    // The server owns the direction for a return: the body is a positive count.
    const returned = await record(type.id, "RETURNED_TO_OWNER", 7);
    expect(returned.statusCode, returned.body).toBe(201);
    expect(returned.json<MovementDto>().quantity).toBe(-7);
    expect(await balanceOf(type.id)).toBe(10);

    const adjustedUp = await record(type.id, "ADJUSTMENT", 3, { note: "Found three extra crates" });
    expect(adjustedUp.statusCode, adjustedUp.body).toBe(201);
    expect(adjustedUp.json<MovementDto>().quantity).toBe(3);
    expect(await balanceOf(type.id)).toBe(13);

    // An ADJUSTMENT carries its own sign.
    const adjustedDown = await record(type.id, "ADJUSTMENT", -1, { note: "One crate was broken" });
    expect(adjustedDown.statusCode, adjustedDown.body).toBe(201);
    expect(adjustedDown.json<MovementDto>().quantity).toBe(-1);
    expect(await balanceOf(type.id)).toBe(12);

    const balances = await h.app.inject({ method: "GET", url: "/empties/balances" });
    expect(balances.statusCode, balances.body).toBe(200);
    const item = balances.json<BalancesDto>().items.find((entry) => entry.typeId === type.id);
    expect(item).toMatchObject({ quantity: 12, unitValueKobo: "100", valueKobo: "1200" });

    const today = getLagosBusinessDate(new Date());
    const movements = await h.app.inject({
      method: "GET",
      url: `/empties/movements?typeId=${type.id}&from=${today}&to=${today}`,
    });
    expect(movements.statusCode, movements.body).toBe(200);
    const page = movements.json<{ items: MovementDto[]; nextCursor: string | null }>();
    expect(page.items).toHaveLength(5);
    expect(page.items.map((movement) => movement.movementType).sort()).toEqual(
      ["ADJUSTMENT", "ADJUSTMENT", "OPENING", "RECEIVED", "RETURNED_TO_OWNER"].sort(),
    );
    expect(page.nextCursor).toBeNull();
  }, 120_000);
});

describe("empties guards", () => {
  it("refuses a return of more empties than are on hand with a friendly 409", async () => {
    const owner = await createOwner();
    const type = await createType({ ownerId: owner.id, label: uniqueLabel() });
    const opening = await record(type.id, "OPENING", 3);
    expect(opening.statusCode, opening.body).toBe(201);
    const before = await movementCountOf(type.id);

    const response = await record(type.id, "RETURNED_TO_OWNER", 4);
    expect(response.statusCode, response.body).toBe(409);
    const body = response.json<ApiError>();
    expect(body.error.code).toBe("BUSINESS_RULE");
    expect(body.error.message).toContain("Only 3");
    expect(body.error.message).toContain(type.label);
    expect(body.error.message).toContain(owner.name);
    expect(await balanceOf(type.id)).toBe(3);
    expect(await movementCountOf(type.id)).toBe(before);

    // A negative adjustment is the other way to push a balance below zero.
    const adjustment = await record(type.id, "ADJUSTMENT", -5, { note: "Write off five" });
    expect(adjustment.statusCode, adjustment.body).toBe(409);
    expect(adjustment.json<ApiError>().error.message).toContain("Only 3");
    expect(await balanceOf(type.id)).toBe(3);
  }, 120_000);

  it("lets exactly one of two simultaneous returns of the last units through (5 iterations)", async () => {
    for (let iteration = 0; iteration < 5; iteration += 1) {
      const owner = await createOwner();
      const type = await createType({ ownerId: owner.id, label: uniqueLabel() });
      const opening = await record(type.id, "OPENING", 5);
      expect(opening.statusCode, opening.body).toBe(201);

      const responses = await Promise.all([0, 1].map(() => record(type.id, "RETURNED_TO_OWNER", 5)));
      const statuses = responses.map((response) => response.statusCode);
      expect(statuses.filter((status) => status === 201), JSON.stringify(statuses)).toHaveLength(1);
      // The loser may be the friendly 409 ("Only N ... on hand") or, if it
      // waited past `lockTimeoutMs`, the 503 the write runner returns for a
      // lost lock race. `accounts-gate.test.ts` asserts only that exactly one
      // succeeded, so the loser's status is deliberately not pinned.
      expect(statuses.filter((status) => status !== 201), JSON.stringify(statuses)).toHaveLength(1);
      expect(await balanceOf(type.id)).toBe(0);
    }
  }, 180_000);

  it("refuses direct UPDATE and DELETE on the append-only tables", async () => {
    const owner = await createOwner();
    const type = await createType({ ownerId: owner.id, label: uniqueLabel() });
    const movement = await record(type.id, "OPENING", 2);
    expect(movement.statusCode, movement.body).toBe(201);

    await expect(
      h.pg.query(`UPDATE empties_movements SET quantity = 99 WHERE "typeId" = $1`, [type.id]),
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      h.pg.query(`DELETE FROM empties_movements WHERE "typeId" = $1`, [type.id]),
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      h.pg.query(`UPDATE empties_balances SET quantity = 99 WHERE "typeId" = $1`, [type.id]),
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      h.pg.query(`DELETE FROM empties_balances WHERE "typeId" = $1`, [type.id]),
    ).rejects.toMatchObject({ code: "P0001" });

    expect(await balanceOf(type.id)).toBe(2);
    expect(await movementCountOf(type.id)).toBe(1);
  });
});

describe("empties reversals", () => {
  it("replays an idempotent movement without recording it twice", async () => {
    const owner = await createOwner();
    const type = await createType({ ownerId: owner.id, label: uniqueLabel() });
    const key = newId("empties-idem");

    const first = await record(type.id, "OPENING", 6, {}, { "idempotency-key": key });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.headers["idempotent-replayed"]).toBeUndefined();
    const firstId = first.json<MovementDto>().id;

    const replay = await record(type.id, "OPENING", 6, {}, { "idempotency-key": key });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(replay.json<MovementDto>().id).toBe(firstId);

    expect(await movementCountOf(type.id)).toBe(1);
    expect(await balanceOf(type.id)).toBe(6);
  }, 120_000);

  it("restores the balance, refuses a second reversal, and refuses a second opening", async () => {
    const owner = await createOwner();
    const type = await createType({ ownerId: owner.id, label: uniqueLabel() });
    const opening = await record(type.id, "OPENING", 10);
    expect(opening.statusCode, opening.body).toBe(201);
    const openingDto = opening.json<MovementDto>();
    expect(await balanceOf(type.id)).toBe(10);

    const reversal = await h.app.inject({
      method: "POST",
      url: `/empties/movements/${openingDto.id}/reverse`,
      payload: { reason: "Counted the wrong type" },
    });
    expect(reversal.statusCode, reversal.body).toBe(201);
    const reversalDto = reversal.json<MovementDto>();
    expect(reversalDto.reversesEntryId).toBe(openingDto.id);
    expect(reversalDto.movementType).toBe("OPENING");
    expect(reversalDto.quantity).toBe(-10);
    expect(await balanceOf(type.id)).toBe(0);
    console.log("STATEMENTS POST /empties/movements/:id/reverse:", h.txLog.at(-1)?.queries);

    const again = await h.app.inject({
      method: "POST",
      url: `/empties/movements/${openingDto.id}/reverse`,
      payload: { reason: "Duplicate reversal attempt" },
    });
    expect(again.statusCode, again.body).toBe(409);
    expect(again.json<ApiError>().error.message).toContain("already been reversed");

    const reverseTheReversal = await h.app.inject({
      method: "POST",
      url: `/empties/movements/${reversalDto.id}/reverse`,
      payload: { reason: "Try to undo the undo" },
    });
    expect(reverseTheReversal.statusCode, reverseTheReversal.body).toBe(409);
    expect(reverseTheReversal.json<ApiError>().error.message).toContain("cannot itself be reversed");

    // The opening row is immutable, so it keeps `reversesEntryId IS NULL`
    // forever and never leaves `ux_empties_movement_opening_active`. A second
    // OPENING is therefore refused for the life of the type — the same rule
    // the accounts ledger enforces (`ux_account_ledger_opening_balance_active`:
    // "Later corrections go through a reconcile ADJUSTMENT, never a second
    // opening balance"). Corrections after a reversal go through an ADJUSTMENT.
    const secondOpening = await record(type.id, "OPENING", 4);
    expect(secondOpening.statusCode, secondOpening.body).toBe(409);
    expect(secondOpening.json<ApiError>().error.details).toMatchObject({
      constraint: "ux_empties_movement_opening_active",
    });
    expect(await balanceOf(type.id)).toBe(0);

    const correction = await record(type.id, "ADJUSTMENT", 4, { note: "Recounted: four on hand" });
    expect(correction.statusCode, correction.body).toBe(201);
    expect(await balanceOf(type.id)).toBe(4);
  }, 180_000);
});

describe("empties owner and type management", () => {
  it("renames, deactivates and reactivates owners and types", async () => {
    const owner = await createOwner();
    console.log("STATEMENTS POST /empties/owners:", h.txLog.at(-1)?.queries);

    const renamed = await h.app.inject({
      method: "PATCH",
      url: `/empties/owners/${owner.id}`,
      payload: { name: `Renamed ${newId("owner")}`.slice(0, 60) },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    console.log("STATEMENTS PATCH /empties/owners/:id:", h.txLog.at(-1)?.queries);

    const type = await createType({ ownerId: owner.id, label: uniqueLabel() });
    console.log("STATEMENTS POST /empties/types:", h.txLog.at(-1)?.queries);

    const patched = await h.app.inject({
      method: "PATCH",
      url: `/empties/types/${type.id}`,
      payload: { label: uniqueLabel(), unitValueKobo: "250" },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json<TypeDto>().unitValueKobo).toBe("250");
    console.log("STATEMENTS PATCH /empties/types/:id:", h.txLog.at(-1)?.queries);

    // An owner with live types cannot be deactivated, so the type goes first.
    const typeOff = await h.app.inject({
      method: "POST",
      url: `/empties/types/${type.id}/deactivate`,
    });
    expect(typeOff.statusCode, typeOff.body).toBe(200);
    console.log("STATEMENTS POST /empties/types/:id/deactivate:", h.txLog.at(-1)?.queries);

    const typeOn = await h.app.inject({
      method: "POST",
      url: `/empties/types/${type.id}/reactivate`,
    });
    expect(typeOn.statusCode, typeOn.body).toBe(200);
    console.log("STATEMENTS POST /empties/types/:id/reactivate:", h.txLog.at(-1)?.queries);

    // Reactivating the type again blocks the owner, so deactivate it once more.
    await h.app.inject({ method: "POST", url: `/empties/types/${type.id}/deactivate` });
    const ownerOff = await h.app.inject({
      method: "POST",
      url: `/empties/owners/${owner.id}/deactivate`,
    });
    expect(ownerOff.statusCode, ownerOff.body).toBe(200);
    expect(ownerOff.json<OwnerDto>().isActive).toBe(false);
    console.log("STATEMENTS POST /empties/owners/:id/deactivate:", h.txLog.at(-1)?.queries);

    const ownerOn = await h.app.inject({
      method: "POST",
      url: `/empties/owners/${owner.id}/reactivate`,
    });
    expect(ownerOn.statusCode, ownerOn.body).toBe(200);
    expect(ownerOn.json<OwnerDto>().isActive).toBe(true);
    console.log("STATEMENTS POST /empties/owners/:id/reactivate:", h.txLog.at(-1)?.queries);
  }, 180_000);

  it("refuses to deactivate an owner that still has an active type", async () => {
    const owner = await createOwner();
    const type = await createType({ ownerId: owner.id, label: uniqueLabel() });
    expect(type.isActive).toBe(true);

    const response = await h.app.inject({
      method: "POST",
      url: `/empties/owners/${owner.id}/deactivate`,
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json<ApiError>().error.message).toContain("active empties type");
    expect((await h.app.inject({ method: "GET", url: "/empties/owners" })).json<OwnerDto[]>().map((o) => o.id)).toContain(owner.id);
  }, 120_000);
});

describe("empties brewery product ownership", () => {
  it("registers the three routes and requires an authenticated actor", async () => {
    const expected = [
      { method: "GET", url: "/empties/overview" },
      { method: "GET", url: "/empties/product-owners" },
      { method: "PUT", url: "/empties/product-owners/:productId" },
    ];
    for (const route of expected) {
      expect(
        h.routes.some((registered) =>
          (Array.isArray(registered.method)
            ? registered.method.includes(route.method)
            : registered.method === route.method) && registered.url === route.url,
        ),
        `${route.method} ${route.url} is registered`,
      ).toBe(true);
    }

    const requests = await Promise.all([
      h.injectAnonymous({ method: "GET", url: "/empties/overview" }),
      h.injectAnonymous({ method: "GET", url: "/empties/product-owners" }),
      h.injectAnonymous({
        method: "PUT",
        url: "/empties/product-owners/nonexistent-product",
        headers: { origin: "http://localhost:3000" },
        payload: { ownerId: null },
      }),
    ]);
    expect(requests.map((response) => response.statusCode)).toEqual([401, 401, 401]);
  });

  it("calculates warehouse crates, loose units, separate shelf stock, warnings, and inactive stock", async () => {
    const brewery = await createOwner();
    const secondBrewery = await createOwner();
    const crateType = await createType({
      ownerId: brewery.id,
      kind: "CRATE",
      unitValueKobo: "5000",
    });
    const bottleType = await createType({ ownerId: brewery.id, kind: "BOTTLE" });
    expect((await record(crateType.id, "OPENING", 10)).statusCode).toBe(201);
    expect((await record(bottleType.id, "OPENING", 3)).statusCode).toBe(201);

    const returnable = await seedProduct(h.pg, {
      name: `ZZTEST returnable ${newId("beer")}`,
      unitsPerPack: 24,
      stock: 100,
      location: "WAREHOUSE",
    });
    await addStockUnits(returnable.id, "RETAIL_SHELF", 30);
    await addStockUnits(returnable.id, "MARKET", 5);
    expect((await setProductOwner(returnable.id, brewery.id)).statusCode).toBe(200);

    const unassigned = await seedProduct(h.pg, {
      name: `ZZTEST unassigned ${newId("beer")}`,
      stock: 3,
      location: "MARKET",
    });
    const cans = await seedProduct(h.pg, {
      name: `ZZTEST cans ${newId("beer")}`,
      unitsPerPack: 1,
      stock: 12,
      location: "WAREHOUSE",
    });
    expect((await setProductOwner(cans.id, brewery.id)).statusCode).toBe(200);

    const inactiveProduct = await seedProduct(h.pg, {
      name: `ZZTEST inactive ${newId("beer")}`,
      unitsPerPack: 12,
      stock: 24,
      location: "WAREHOUSE",
      deactivated: true,
    });
    expect((await setProductOwner(inactiveProduct.id, secondBrewery.id)).statusCode).toBe(200);

    const response = await h.app.inject({ method: "GET", url: "/empties/overview" });
    expect(response.statusCode, response.body).toBe(200);
    const overview = response.json<EmptiesOverviewDto>();
    const first = overview.owners.find((owner) => owner.ownerId === brewery.id)!;
    const second = overview.owners.find((owner) => owner.ownerId === secondBrewery.id)!;

    // Hand check: 100 / 24 = 4 crates with 4 loose warehouse units.
    // The 30 shelf and 5 MARKET units are bottles, not crates; 10 empties + 4 full = 14.
    expect(first).toMatchObject({
      emptyCrates: 10,
      emptyBottles: 3,
      fullCrates: 4,
      totalCrates: 14,
      bottlesOnShelfAndMarket: 35,
      emptyValueKobo: "50000",
    });
    expect(
      first.products.find((product) => product.productId === returnable.id),
    ).toMatchObject({
      warehouseUnits: 100,
      fullCrates: 4,
      looseUnits: 4,
      shelfUnits: 30,
      marketUnits: 5,
    });
    expect(first.products.find((product) => product.productId === cans.id)).toMatchObject({
      fullCrates: 0,
      looseUnits: 12,
    });
    expect(second).toMatchObject({ fullCrates: 2, totalCrates: 2 });
    expect(
      second.products.find((product) => product.productId === inactiveProduct.id),
    ).toMatchObject({ isActive: false, fullCrates: 2 });
    expect(overview.warnings.productsWithoutBrewery).toContainEqual(
      expect.objectContaining({ productId: unassigned.id, productName: unassigned.name, totalUnits: 3 }),
    );
    expect(overview.warnings.assignedCans).toContainEqual(
      expect.objectContaining({ productId: cans.id, productName: cans.name, ownerId: brewery.id }),
    );
  }, 180_000);

  it("filters and paginates active products with a stable cursor", async () => {
    const owner = await createOwner();
    const prefix = `ZZTEST owner page ${newId("products")}`;
    const firstProduct = await seedProduct(h.pg, { name: `${prefix} A` });
    const secondProduct = await seedProduct(h.pg, { name: `${prefix} B` });
    const inactiveProduct = await seedProduct(h.pg, { name: `${prefix} inactive`, deactivated: true });
    expect((await setProductOwner(firstProduct.id, owner.id)).statusCode).toBe(200);

    const firstPageResponse = await h.app.inject({
      method: "GET",
      url: `/empties/product-owners?q=${encodeURIComponent(prefix)}&limit=1`,
    });
    expect(firstPageResponse.statusCode, firstPageResponse.body).toBe(200);
    const firstPage = firstPageResponse.json<ProductOwnerPageDto>();
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPageResponse = await h.app.inject({
      method: "GET",
      url: `/empties/product-owners?q=${encodeURIComponent(prefix)}&limit=1&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
    });
    const secondPage = secondPageResponse.json<ProductOwnerPageDto>();
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]?.productId).not.toBe(firstPage.items[0]?.productId);

    const assigned = await h.app.inject({
      method: "GET",
      url: `/empties/product-owners?q=${encodeURIComponent(prefix)}&assigned=assigned`,
    });
    expect(assigned.json<ProductOwnerPageDto>().items.map((item) => item.productId)).toEqual([
      firstProduct.id,
    ]);
    const unassigned = await h.app.inject({
      method: "GET",
      url: `/empties/product-owners?q=${encodeURIComponent(prefix)}&assigned=unassigned`,
    });
    expect(unassigned.json<ProductOwnerPageDto>().items.map((item) => item.productId).sort()).toEqual(
      [secondProduct.id].sort(),
    );
    expect(
      [...firstPage.items, ...secondPage.items].some((item) => item.productId === inactiveProduct.id),
    ).toBe(false);
  }, 120_000);

  it("assigns, reassigns, unassigns idempotently and audit-logs only actual changes", async () => {
    const firstOwner = await createOwner();
    const secondOwner = await createOwner();
    const product = await seedProduct(h.pg, { name: `ZZTEST assignment ${newId("beer")}` });
    const key = newId("empties-owner-key");

    const first = await setProductOwner(product.id, firstOwner.id, key);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json<ProductOwnerDto>()).toMatchObject({
      productId: product.id,
      ownerId: firstOwner.id,
    });
    expect(h.txLog.at(-1)?.queries).toBe(11);

    const replay = await setProductOwner(product.id, firstOwner.id, key);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.headers["idempotent-replayed"]).toBe("true");

    const sameOwner = await setProductOwner(product.id, firstOwner.id);
    expect(sameOwner.statusCode, sameOwner.body).toBe(200);

    const reassigned = await setProductOwner(product.id, secondOwner.id);
    expect(reassigned.statusCode, reassigned.body).toBe(200);
    expect(reassigned.json<ProductOwnerDto>().ownerId).toBe(secondOwner.id);

    const unassigned = await setProductOwner(product.id, null);
    expect(unassigned.statusCode, unassigned.body).toBe(200);
    expect(unassigned.json<ProductOwnerDto>()).toMatchObject({
      productId: product.id,
      ownerId: null,
      ownerName: null,
    });

    const auditRows = await h.pg.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_logs
        WHERE action = 'EMPTIES_PRODUCT_OWNER_CHANGED' AND "entityId" = $1`,
      [product.id],
    );
    expect(auditRows.rows[0]?.count).toBe("3");
  }, 120_000);

  it("refuses inactive or missing owners and warns when an assigned brewery is deactivated", async () => {
    const owner = await createOwner();
    const product = await seedProduct(h.pg, {
      name: `ZZTEST inactive owner ${newId("beer")}`,
      unitsPerPack: 24,
      stock: 50,
      location: "WAREHOUSE",
    });
    expect((await setProductOwner(product.id, newId("missing_owner"))).statusCode).toBe(404);
    expect((await setProductOwner(product.id, owner.id)).statusCode).toBe(200);

    const deactivated = await h.app.inject({
      method: "POST",
      url: `/empties/owners/${owner.id}/deactivate`,
    });
    expect(deactivated.statusCode, deactivated.body).toBe(200);
    const overview = await h.app.inject({ method: "GET", url: "/empties/overview" });
    const body = overview.json<EmptiesOverviewDto>();
    expect(body.owners.some((item) => item.ownerId === owner.id)).toBe(false);
    expect(body.warnings.productsAssignedToInactiveOwner).toContainEqual(
      expect.objectContaining({ productId: product.id, productName: product.name, ownerId: owner.id }),
    );
  }, 120_000);
});

describe("empties db:audit", () => {
  it("leaves every fatal audit check with zero offending rows", async () => {
    const audit = await runDbAudit(connectionString);
    const failing = audit.checks.filter(
      (check) => check.error !== undefined || (check.severity === "fatal" && check.rowCount > 0),
    );
    expect(
      failing,
      JSON.stringify(
        failing.map((check) => `${check.name}: ${check.rowCount} (${check.error ?? "rows"})`),
        null,
        2,
      ),
    ).toEqual([]);
    expect(audit.ok).toBe(true);
  });
});
