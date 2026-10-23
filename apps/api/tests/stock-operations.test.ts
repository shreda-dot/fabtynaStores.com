import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  stockAdjustmentDtoSchema,
  stockAdjustmentLineDtoSchema,
  stockMovementDtoSchema,
  stockTransferDtoSchema,
  stockTransferLegDtoSchema,
  stockTransferLineDtoSchema,
} from "@fabtyna/shared";
import {
  averageCostOf,
  call,
  createHarness,
  newId,
  seedBlankProduct,
  seedProduct,
  stockOf,
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

describe("stock transfers API", () => {
  it("moves stock between locations and keeps balances correct", async () => {
    const product = await seedProduct(h.pg, { stock: 20, location: "WAREHOUSE", averageCostKobo: 7000n });
    const res = await call(h.app, "POST", "/transfers", {
      from: "WAREHOUSE",
      to: "RETAIL_SHELF",
      reason: "Shelf refill",
      transferredAt: isoNowMinusMinutes(3),
      lines: [{ productId: product.id, quantityUnits: 6 }],
    });
    expect(res.status).toBe(201);
    expect(await stockOf(h.pg, product.id, "WAREHOUSE")).toBe(14);
    expect(await stockOf(h.pg, product.id, "RETAIL_SHELF")).toBe(6);
  });

  it("refuses insufficient stock with friendly message and no writes", async () => {
    const product = await seedProduct(h.pg, { stock: 3, location: "WAREHOUSE" });
    const before = await h.pg.query(`SELECT count(*)::int AS n FROM stock_transfers`);
    const res = await call(h.app, "POST", "/transfers", {
      from: "WAREHOUSE",
      to: "MARKET",
      reason: "Move too much",
      transferredAt: isoNowMinusMinutes(2),
      lines: [{ productId: product.id, quantityUnits: 4 }],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain(product.name);
    expect(res.body.error.message).toContain("available");
    expect(res.body.error.message).toContain("requested");
    const after = await h.pg.query(`SELECT count(*)::int AS n FROM stock_transfers`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    expect(await stockOf(h.pg, product.id, "WAREHOUSE")).toBe(3);
    expect(await stockOf(h.pg, product.id, "MARKET")).toBe(0);
  });

  it("rejects same-location and inactive-product transfers", async () => {
    const active = await seedProduct(h.pg, { stock: 5, location: "WAREHOUSE" });
    const sameLocation = await call(h.app, "POST", "/transfers", {
      from: "WAREHOUSE",
      to: "WAREHOUSE",
      transferredAt: isoNowMinusMinutes(2),
      lines: [{ productId: active.id, quantityUnits: 1 }],
    });
    expect(sameLocation.status).toBe(400);

    const inactive = await seedProduct(h.pg, {
      stock: 5,
      location: "WAREHOUSE",
      deactivated: true,
    });
    const inactiveRes = await call(h.app, "POST", "/transfers", {
      from: "WAREHOUSE",
      to: "RETAIL_SHELF",
      transferredAt: isoNowMinusMinutes(1),
      lines: [{ productId: inactive.id, quantityUnits: 1 }],
    });
    expect(inactiveRes.status).toBe(409);
    expect(inactiveRes.body.error.message).toContain("deactivated");
  });

  it("allows exactly one of two simultaneous transfers of the last units", async () => {
    const product = await seedProduct(h.pg, { stock: 5, location: "WAREHOUSE" });
    const [a, b] = await Promise.all(
      [0, 1].map(() =>
        call(h.app, "POST", "/transfers", {
          from: "WAREHOUSE",
          to: "RETAIL_SHELF",
          transferredAt: isoNowMinusMinutes(1),
          lines: [{ productId: product.id, quantityUnits: 5 }],
        }),
      ),
    );
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect(await stockOf(h.pg, product.id, "WAREHOUSE")).toBe(0);
    expect(await stockOf(h.pg, product.id, "RETAIL_SHELF")).toBe(5);
  });

  it("lists transfers with today default date range", async () => {
    const list = await call(h.app, "GET", "/transfers");
    expect(list.status).toBe(200);
    expect(typeof list.body.from).toBe("string");
    expect(typeof list.body.to).toBe("string");
  });
});

describe("stock adjustments API", () => {
  it("applies positive and negative adjustments and updates average cost", async () => {
    const product = await seedBlankProduct(h.pg, { unitsPerPack: 12 });
    const positive = await call(h.app, "POST", "/adjustments", {
      reason: "Found stock",
      adjustedAt: isoNowMinusMinutes(5),
      lines: [{ productId: product.id, location: "WAREHOUSE", quantityDeltaUnits: 10, unitCostKobo: "5000" }],
    });
    expect(positive.status).toBe(201);
    expect(await stockOf(h.pg, product.id, "WAREHOUSE")).toBe(10);
    expect(await averageCostOf(h.pg, product.id)).toBe(5000n);

    const negative = await call(h.app, "POST", "/adjustments", {
      reason: "Damaged items",
      adjustedAt: isoNowMinusMinutes(4),
      lines: [{ productId: product.id, location: "WAREHOUSE", quantityDeltaUnits: -3, reason: "Breakage" }],
    });
    expect(negative.status).toBe(201);
    expect(await stockOf(h.pg, product.id, "WAREHOUSE")).toBe(7);
  });

  it("refuses a negative adjustment beyond stock", async () => {
    const product = await seedProduct(h.pg, { stock: 2, location: "MARKET", averageCostKobo: 3000n });
    const res = await call(h.app, "POST", "/adjustments", {
      reason: "Too large reduction",
      adjustedAt: isoNowMinusMinutes(3),
      lines: [{ productId: product.id, location: "MARKET", quantityDeltaUnits: -3, reason: "Count" }],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain(product.name);
    expect(await stockOf(h.pg, product.id, "MARKET")).toBe(2);
  });

  it("voids an adjustment and restores stock and average cost", async () => {
    const product = await seedProduct(h.pg, {
      stock: 10,
      location: "WAREHOUSE",
      averageCostKobo: 1000n,
    });
    const adjustment = await call(h.app, "POST", "/adjustments", {
      reason: "Cost correction",
      adjustedAt: isoNowMinusMinutes(2),
      lines: [{ productId: product.id, location: "WAREHOUSE", quantityDeltaUnits: 4, unitCostKobo: "7000" }],
    });
    expect(adjustment.status).toBe(201);
    const id = adjustment.body.id as string;
    expect(await stockOf(h.pg, product.id, "WAREHOUSE")).toBe(14);

    const before = await averageCostOf(h.pg, product.id);
    const voided = await call(h.app, "POST", `/adjustments/${id}/void`, {});
    expect(voided.status).toBe(200);
    expect(await stockOf(h.pg, product.id, "WAREHOUSE")).toBe(10);
    expect(await averageCostOf(h.pg, product.id)).not.toBe(before);
  });

  it("refuses void when reversal would take stock below zero and rejects double void", async () => {
    const product = await seedProduct(h.pg, { stock: 3, location: "WAREHOUSE", averageCostKobo: 2500n });
    const adjustment = await call(h.app, "POST", "/adjustments", {
      reason: "Found cartons",
      adjustedAt: isoNowMinusMinutes(2),
      lines: [{ productId: product.id, location: "WAREHOUSE", quantityDeltaUnits: 2, unitCostKobo: "2500" }],
    });
    const id = adjustment.body.id as string;
    const consume = await call(h.app, "POST", "/adjustments", {
      reason: "Shrinkage",
      adjustedAt: isoNowMinusMinutes(1),
      lines: [{ productId: product.id, location: "WAREHOUSE", quantityDeltaUnits: -5, reason: "Sold/missing" }],
    });
    expect(consume.status).toBe(201);

    const blocked = await call(h.app, "POST", `/adjustments/${id}/void`, {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toContain(product.name);

    const normal = await call(h.app, "POST", "/adjustments", {
      reason: "Simple add",
      adjustedAt: isoNowMinusMinutes(1),
      lines: [{ productId: product.id, location: "WAREHOUSE", quantityDeltaUnits: 1, unitCostKobo: "2500" }],
    });
    const normalId = normal.body.id as string;
    const firstVoid = await call(h.app, "POST", `/adjustments/${normalId}/void`, {});
    expect(firstVoid.status).toBe(200);
    const secondVoid = await call(h.app, "POST", `/adjustments/${normalId}/void`, {});
    expect(secondVoid.status).toBe(409);
  });

  it("allows exactly one of two simultaneous negative adjustments of the last unit", async () => {
    const product = await seedProduct(h.pg, { stock: 1, location: "MARKET" });
    const [a, b] = await Promise.all(
      [0, 1].map(() =>
        call(h.app, "POST", "/adjustments", {
          reason: `Concurrent shrink ${newId("adj")}`,
          adjustedAt: isoNowMinusMinutes(1),
          lines: [{ productId: product.id, location: "MARKET", quantityDeltaUnits: -1, reason: "Count" }],
        }),
      ),
    );
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect(await stockOf(h.pg, product.id, "MARKET")).toBe(0);
  });
});

/**
 * Regression: the transfer and adjustment VIEW screens failed in production
 * because both read endpoints answered 500 (the query spread the Prisma row's
 * `lines`/`stockMovements` relations into a `.strict()` DTO schema) and the
 * list rows did not match `StockTransferDto`/`StockAdjustmentDto` at all. The
 * create/void paths then failed too, because the web adapters re-read the
 * detail after every write. These tests parse every response with the exact
 * shared schemas the web contract is built on.
 */
describe("stock read endpoints satisfy the shared DTO contract", () => {
  it("serves a transfer list and detail the shared schemas accept", async () => {
    const product = await seedProduct(h.pg, {
      stock: 8,
      location: "WAREHOUSE",
      averageCostKobo: 4000n,
    });
    const created = await call(h.app, "POST", "/transfers", {
      from: "WAREHOUSE",
      to: "RETAIL_SHELF",
      reason: "Read contract",
      transferredAt: isoNowMinusMinutes(1),
      lines: [{ productId: product.id, quantityUnits: 2 }],
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const list = await call(h.app, "GET", "/transfers?limit=200");
    expect(list.status).toBe(200);
    const items = list.body.items as unknown[];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(() => stockTransferDtoSchema.parse(item)).not.toThrow();
    }

    const detail = await call(h.app, "GET", `/transfers/${id}`);
    expect(detail.status).toBe(200);
    const { lines, legs, movements, ...base } = detail.body as Record<string, unknown>;
    expect(() => stockTransferDtoSchema.parse(base)).not.toThrow();

    expect(Array.isArray(lines)).toBe(true);
    for (const line of lines as Record<string, unknown>[]) {
      const { productName, legs: lineLegs, ...lineBase } = line;
      expect(typeof productName).toBe("string");
      expect(() => stockTransferLineDtoSchema.parse(lineBase)).not.toThrow();
      for (const leg of (lineLegs ?? []) as unknown[]) {
        expect(() => stockTransferLegDtoSchema.parse(leg)).not.toThrow();
      }
    }
    for (const leg of legs as unknown[]) {
      expect(() => stockTransferLegDtoSchema.parse(leg)).not.toThrow();
    }
    for (const movement of movements as unknown[]) {
      expect(() => stockMovementDtoSchema.parse(movement)).not.toThrow();
    }
  });

  it("serves an adjustment list and detail the shared schemas accept", async () => {
    const product = await seedBlankProduct(h.pg, { unitsPerPack: 12 });
    const created = await call(h.app, "POST", "/adjustments", {
      reason: "Read contract",
      adjustedAt: isoNowMinusMinutes(1),
      lines: [
        {
          productId: product.id,
          location: "WAREHOUSE",
          quantityDeltaUnits: 3,
          unitCostKobo: "5000",
        },
      ],
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const list = await call(h.app, "GET", "/adjustments?limit=200");
    expect(list.status).toBe(200);
    const items = list.body.items as unknown[];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(() => stockAdjustmentDtoSchema.parse(item)).not.toThrow();
    }

    const detail = await call(h.app, "GET", `/adjustments/${id}`);
    expect(detail.status).toBe(200);
    const { lines, movements, ...base } = detail.body as Record<string, unknown>;
    expect(() => stockAdjustmentDtoSchema.parse(base)).not.toThrow();

    expect(Array.isArray(lines)).toBe(true);
    for (const line of lines as Record<string, unknown>[]) {
      const { productName, ...lineBase } = line;
      expect(typeof productName).toBe("string");
      expect(() => stockAdjustmentLineDtoSchema.parse(lineBase)).not.toThrow();
    }
    for (const movement of movements as unknown[]) {
      expect(() => stockMovementDtoSchema.parse(movement)).not.toThrow();
    }
  });
});

