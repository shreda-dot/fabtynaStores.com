import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { calculateSizeClassTotals } from "@fabtyna/shared";
import {
  createHarness,
  newId,
  postPurchase,
  postSale,
  purchaseBody,
  saleBody,
  seedCustomer,
  seedProduct,
  seedSupplier,
  stockOf,
  type Harness,
} from "./sales-fixtures.js";

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.pg.query(`UPDATE empties_size_class_mode SET phase = 'LEGACY' WHERE id = 1`);
});

afterAll(async () => {
  await h.close();
});

async function setPhase(phase: "LEGACY" | "RECOUNT_PENDING" | "READY") {
  await h.pg.query(`UPDATE empties_size_class_mode SET phase = $1 WHERE id = 1`, [phase]);
}

async function setup(location: "WAREHOUSE" | "RETAIL_SHELF" = "RETAIL_SHELF") {
  const product = await seedProduct(h.pg, { unitsPerPack: 12, stock: 12, location });
  const customer = await seedCustomer(h.pg, { type: location === "WAREHOUSE" ? "WHOLESALE" : "RETAIL" });
  const ownerId = newId("size_owner");
  const typeId = newId("size_type");
  const nextTypeId = newId("size_type");
  await h.pg.query(
    `INSERT INTO empties_owners (id, name, "normalizedKey") VALUES ($1, $1, $1)`,
    [ownerId],
  );
  await h.pg.query(
    `INSERT INTO empties_types (id, "ownerId", kind, label, capacity)
     VALUES ($1, $3, 'BOTTLE', 'Size 12', 12), ($2, $3, 'BOTTLE', 'Size 20', 20)`,
    [typeId, nextTypeId, ownerId],
  );
  const assign = await h.app.inject({
    method: "PUT",
    url: `/empties/product-owners/${product.id}`,
    payload: { ownerId },
  });
  expect(assign.statusCode, assign.body).toBe(200);
  const configure = (id: string) => h.app.inject({
    method: "PUT",
    url: `/empties/products/${product.id}/purchase-setup`,
    payload: {
      classification: "RETURNABLE",
      mappings: [{ kind: "BOTTLE", typeId: id, countPerUnit: 1, cratesPerPack: 1 }],
    },
  });
  const configured = await configure(typeId);
  expect(configured.statusCode, configured.body).toBe(200);
  await h.pg.query(
    `INSERT INTO empties_movements (id, "typeId", "movementType", quantity, note, "createdById")
     VALUES ($1, $2, 'ADJUSTMENT', 60, 'manual count', $3)`,
    [newId("size_count"), typeId, h.actor.id],
  );
  return { product, customer, ownerId, typeId, nextTypeId, configure };
}

async function emptyBalance(typeId: string): Promise<number> {
  const result = await h.pg.query<{ quantity: number }>(
    `SELECT quantity FROM empties_balances WHERE "typeId" = $1`,
    [typeId],
  );
  return result.rows[0]?.quantity ?? 0;
}

describe("size-class sales", () => {
  it("moves each retail bottle into its confirmed size, freezes the mapping and reverses the sale", async () => {
    const { product, customer, ownerId, typeId, nextTypeId, configure } = await setup();
    await setPhase("READY");
    const before = calculateSizeClassTotals(12, [12, 0, 0], await emptyBalance(typeId));
    const transfer = await h.app.inject({
      method: "POST",
      url: "/transfers",
      payload: {
        from: "RETAIL_SHELF",
        to: "MARKET",
        reason: "Size-class transfer check",
        transferredAt: new Date().toISOString(),
        lines: [{ productId: product.id, quantityUnits: 12 }],
      },
    });
    expect(transfer.statusCode, transfer.body).toBe(201);
    const overviewBefore = await h.app.inject({ method: "GET", url: "/empties/overview" });
    expect(overviewBefore.statusCode, overviewBefore.body).toBe(200);
    const classBefore = overviewBefore.json<{ owners: Array<{ ownerId: string; sizeClasses: Array<{
      typeId: string; stockBottles: number; emptyCrates: number; totalCrates: number;
    }> }> }>().owners.find((row) => row.ownerId === ownerId)!.sizeClasses
      .find((row) => row.typeId === typeId);
    expect(classBefore).toMatchObject({ stockBottles: 12, emptyCrates: 5, totalCrates: 6 });
    expect([classBefore!.totalCrates, classBefore!.looseTotalBottles]).toEqual([
      before.totalCrates,
      before.looseTotalBottles,
    ]);
    const sale = await postSale(h.app, saleBody({
      productId: product.id, customerId: customer.id, location: "MARKET", quantity: 12,
    }));
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    const after = calculateSizeClassTotals(
      12, [await stockOf(h.pg, product.id, "MARKET"), 0, 0], await emptyBalance(typeId),
    );
    expect([before.emptyCrates, after.emptyCrates]).toEqual([5, 6]);
    expect([after.totalCrates, after.looseTotalBottles]).toEqual([
      before.totalCrates,
      before.looseTotalBottles,
    ]);
    const unchanged = await configure(typeId);
    expect(unchanged.statusCode, unchanged.body).toBe(200);
    const blocked = await configure(nextTypeId);
    expect(blocked.statusCode, blocked.body).toBe(409);
    const voided = await h.app.inject({ method: "POST", url: `/sales/${sale.body.id}/void` });
    expect(voided.statusCode, voided.body).toBe(200);
    expect(await stockOf(h.pg, product.id, "MARKET")).toBe(12);
    expect(await emptyBalance(typeId)).toBe(60);
    const restored = calculateSizeClassTotals(
      12, [await stockOf(h.pg, product.id, "MARKET"), 0, 0], await emptyBalance(typeId),
    );
    expect([restored.totalCrates, restored.looseTotalBottles]).toEqual([
      before.totalCrates,
      before.looseTotalBottles,
    ]);
    const corrected = await configure(nextTypeId);
    expect(corrected.statusCode, corrected.body).toBe(200);
  });

  it("conserves bottles for a partial wholesale pack and its void", async () => {
    const { product, customer, typeId } = await setup("WAREHOUSE");
    await setPhase("READY");
    const sale = await postSale(h.app, saleBody({
      productId: product.id, customerId: customer.id,
      channel: "WHOLESALE", location: "WAREHOUSE", unit: "PACK", quantity: 0.5,
    }));
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    expect(await stockOf(h.pg, product.id, "WAREHOUSE")).toBe(6);
    expect(await emptyBalance(typeId)).toBe(66);
    const voided = await h.app.inject({ method: "POST", url: `/sales/${sale.body.id}/void` });
    expect(voided.statusCode, voided.body).toBe(200);
    expect(await stockOf(h.pg, product.id, "WAREHOUSE")).toBe(12);
    expect(await emptyBalance(typeId)).toBe(60);
  });

  it("rejects an unconfirmed returnable size rather than using legacy sale packaging", async () => {
    const { product, customer, typeId } = await setup();
    await h.pg.query(`DELETE FROM purchase_empties_packaging WHERE "productId" = $1`, [product.id]);
    await setPhase("READY");
    const sale = await postSale(h.app, saleBody({ productId: product.id, customerId: customer.id }));
    expect(sale.status, JSON.stringify(sale.body)).toBe(409);
    expect(await emptyBalance(typeId)).toBe(60);
    expect(await stockOf(h.pg, product.id, "RETAIL_SHELF")).toBe(12);
  });

  it("pauses sales, voids and returnable purchases during recount but permits non-returnables", async () => {
    const { product, customer } = await setup();
    const nonReturnable = await seedProduct(h.pg);
    await setPhase("RECOUNT_PENDING");
    const sale = await postSale(h.app, saleBody({ productId: product.id, customerId: customer.id }));
    expect(sale.status, JSON.stringify(sale.body)).toBe(409);
    const voided = await h.app.inject({ method: "POST", url: `/sales/${newId("sale")}/void` });
    expect(voided.statusCode, voided.body).toBe(409);
    const blocked = await postPurchase(h.app, purchaseBody({ productId: product.id }));
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(409);
    const supplier = await seedSupplier(h.pg);
    const allowed = await postPurchase(h.app, purchaseBody({
      productId: nonReturnable.id, supplierId: supplier.id,
    }));
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(201);
  });

  it("checks purchase empties in whole size-class crates and records bottle-based debt", async () => {
    const { product, typeId } = await setup("WAREHOUSE");
    await h.pg.query(
      `INSERT INTO empties_movements (id, "typeId", "movementType", quantity, note, "createdById")
       VALUES ($1, $2, 'ADJUSTMENT', -48, 'prepare purchase shortage case', $3)`,
      [newId("size_count"), typeId, h.actor.id],
    );
    const supplier = await seedSupplier(h.pg);
    await setPhase("READY");
    const purchase = await postPurchase(h.app, {
      ...purchaseBody({
        supplierId: supplier.id,
        lines: [{
          productId: product.id,
          unit: "PACK",
          quantity: 2,
          lineTotalKobo: "20000",
          emptiesCrateCount: 2,
        }],
      }),
      emptiesResolutions: [{ typeId, suppliedFree: 0, owed: 12 }],
    });
    expect(purchase.status, JSON.stringify(purchase.body)).toBe(201);
    expect(await emptyBalance(typeId)).toBe(0);
    const eventRows = await h.pg.query<{ eventType: string; quantity: number; obligationId: string | null }>(
      `SELECT "eventType"::text AS "eventType", quantity, "obligationId"
         FROM supplier_empties_events WHERE "purchaseId" = $1 AND "reversesEntryId" IS NULL
         ORDER BY "eventType"`,
      [purchase.body.id],
    );
    expect(eventRows.rows.map(({ eventType, quantity }) => ({ eventType, quantity }))).toEqual([
      { eventType: "PURCHASE_DEBT", quantity: 12 },
      { eventType: "RETURNED_FOR_PURCHASE", quantity: -12 },
    ]);
    const debt = eventRows.rows.find((row) => row.eventType === "PURCHASE_DEBT")!;
    expect(debt.obligationId).not.toBeNull();
    const openingDebt = await h.app.inject({
      method: "POST",
      url: "/empties/supplier-debts/opening",
      payload: { supplierId: supplier.id, typeId, quantity: 12, note: "additional crate debt" },
    });
    expect(openingDebt.statusCode, openingDebt.body).toBe(201);
    await expect(h.pg.query(
      `INSERT INTO supplier_empties_events
         (id, "eventType", "typeId", "obligationId", quantity, note, "createdById")
       VALUES ($1, 'OPENING_DEBT', $2, $3, 1, 'must be whole crates', $4)`,
      [newId("invalid_supplier_event"), typeId, openingDebt.json<{ id: string }>().id, h.actor.id],
    )).rejects.toThrow("whole crates");
    const fractionalAllocation = await h.app.inject({
      method: "POST",
      url: "/empties/supplier-debts/settle",
      payload: {
        supplierId: supplier.id,
        typeId,
        quantity: 12,
        allocations: [
          { obligationId: debt.obligationId, quantity: 6 },
          { obligationId: openingDebt.json<{ id: string }>().id, quantity: 6 },
        ],
      },
    });
    expect(fractionalAllocation.statusCode).toBe(409);

    await h.pg.query(
      `INSERT INTO empties_movements (id, "typeId", "movementType", quantity, note, "createdById")
       VALUES ($1, $2, 'ADJUSTMENT', 12, 'prepare supplier settlement', $3)`,
      [newId("size_count"), typeId, h.actor.id],
    );
    const settled = await h.app.inject({
      method: "POST",
      url: "/empties/supplier-debts/settle",
      payload: { supplierId: supplier.id, typeId, quantity: 12 },
    });
    expect(settled.statusCode, settled.body).toBe(201);
    expect(await emptyBalance(typeId)).toBe(0);
  });

  it("serializes size-class purchases competing for the last whole crate", async () => {
    const { product, typeId } = await setup("WAREHOUSE");
    await h.pg.query(
      `INSERT INTO empties_movements (id, "typeId", "movementType", quantity, note, "createdById")
       VALUES ($1, $2, 'ADJUSTMENT', -48, 'leave one crate for concurrency check', $3)`,
      [newId("size_count"), typeId, h.actor.id],
    );
    const supplier = await seedSupplier(h.pg);
    await setPhase("READY");
    const body = () => purchaseBody({
      supplierId: supplier.id,
      lines: [{
        productId: product.id,
        unit: "PACK",
        quantity: 1,
        lineTotalKobo: "10000",
        emptiesCrateCount: 1,
      }],
    });
    const results = await Promise.all([
      postPurchase(h.app, body()),
      postPurchase(h.app, body()),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(await emptyBalance(typeId)).toBe(0);
    const returns = await h.pg.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM supplier_empties_events
        WHERE "typeId" = $1 AND "eventType" = 'RETURNED_FOR_PURCHASE'
          AND "reversesEntryId" IS NULL`,
      [typeId],
    );
    expect(Number(returns.rows[0]!.count)).toBe(1);
  });

  it("atomically confirms crate-and-loose counts with audited adjustments", async () => {
    const { typeId, nextTypeId } = await setup();
    const status = await h.app.inject({ method: "GET", url: "/empties/size-class-recount" });
    expect(status.statusCode, status.body).toBe(200);
    const current = status.json<{
      phase: string;
      classes: Array<{ typeId: string; capacity: number; quantity: number }>;
    }>();
    expect(current.phase).toBe("LEGACY");
    expect(current.classes).toEqual(expect.arrayContaining([
      expect.objectContaining({ typeId, quantity: 60 }),
      expect.objectContaining({ typeId: nextTypeId, quantity: 0 }),
    ]));

    const started = await h.app.inject({
      method: "POST",
      url: "/empties/size-class-recount/begin",
      payload: {},
      headers: { "idempotency-key": "size-recount-start" },
    });
    expect(started.statusCode, started.body).toBe(200);
    expect(started.json()).toEqual({ phase: "RECOUNT_PENDING" });

    const desiredCounts = new Map([
      [typeId, { emptyCrates: 4, looseBottles: 3 }],
      [nextTypeId, { emptyCrates: 2, looseBottles: 5 }],
    ]);
    const counts = current.classes.map((sizeClass) => ({
      typeId: sizeClass.typeId,
      ...(desiredCounts.get(sizeClass.typeId) ?? {
        emptyCrates: Math.floor(sizeClass.quantity / sizeClass.capacity),
        looseBottles: sizeClass.quantity % sizeClass.capacity,
      }),
    }));
    const invalid = await h.app.inject({
      method: "POST",
      url: "/empties/size-class-recount",
      payload: { counts: [{ ...counts[0]! }, { ...counts[1]!, looseBottles: 20 }], reason: "Opening count" },
    });
    expect(invalid.statusCode, invalid.body).toBe(400);
    expect(await emptyBalance(typeId)).toBe(60);
    expect(await emptyBalance(nextTypeId)).toBe(0);

    const confirmed = await h.app.inject({
      method: "POST",
      url: "/empties/size-class-recount",
      payload: { counts, reason: "Opening count after launch" },
      headers: { "idempotency-key": "size-recount-confirm" },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json<{ phase: string }>().phase).toBe("READY");
    expect(await emptyBalance(typeId)).toBe(51);
    expect(await emptyBalance(nextTypeId)).toBe(45);
    const auditRows = await h.pg.query<{ action: string; count: string }>(
      `SELECT action, COUNT(*)::text AS count FROM audit_logs
        WHERE "actorId" = $1
          AND action IN ('EMPTIES_SIZE_CLASS_RECOUNT_ADJUSTMENT', 'EMPTIES_SIZE_CLASS_RECOUNT_CONFIRMED')
        GROUP BY action ORDER BY action`,
      [h.actor.id],
    );
    expect(auditRows.rows).toEqual([
      { action: "EMPTIES_SIZE_CLASS_RECOUNT_ADJUSTMENT", count: "2" },
      { action: "EMPTIES_SIZE_CLASS_RECOUNT_CONFIRMED", count: "1" },
    ]);
    const finalStatus = await h.app.inject({ method: "GET", url: "/empties/size-class-recount" });
    const finalClasses = finalStatus.json<{ phase: string; classes: Array<{ typeId: string }> }>();
    expect(finalClasses.phase).toBe("READY");
    expect(finalClasses.classes.map((row) => row.typeId).sort())
      .toEqual(current.classes.map((row) => row.typeId).sort());

    const replay = await h.app.inject({
      method: "POST",
      url: "/empties/size-class-recount",
      payload: { counts, reason: "Opening count after launch" },
      headers: { "idempotency-key": "size-recount-confirm" },
    });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(await emptyBalance(typeId)).toBe(51);
  });
});
