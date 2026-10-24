import { describe, expect, it } from "vitest";
import { salesSummary } from "../domain/operations.ts";
import type { Product, Sale, SaleLine, SalePayment } from "../domain/types.ts";

// Lagos days are UTC+1, so a Lagos day starts at 23:00 UTC the evening before.
const FROM = new Date("2026-10-13T23:00:00.000Z"); // start of 14 Oct
const TO = new Date("2026-10-15T23:00:00.000Z"); // end of 15 Oct (exclusive)
const OCT14 = new Date("2026-10-14T08:00:00.000Z");
const OCT15 = new Date("2026-10-15T08:00:00.000Z");
const OCT15_LATE = new Date("2026-10-15T09:00:00.000Z");

function product(id: string, averageCostKobo: bigint): Product {
  return {
    id,
    unitsPerPack: 1,
    averageCostKobo,
    retailPriceKobo: 0n,
    wholesalePriceKobo: 0n,
  } as unknown as Product;
}

function sale(
  id: string,
  soldAt: Date,
  totalKobo: bigint,
  paidKobo: bigint,
  status: "COMPLETED" | "VOIDED" = "COMPLETED",
): Sale {
  return {
    id,
    customerId: "c1",
    customerName: null,
    createdById: "u1",
    channel: "RETAIL",
    status,
    reference: null,
    notes: null,
    totalKobo,
    paidKobo,
    soldAt,
    createdAt: soldAt,
    updatedAt: soldAt,
  } as unknown as Sale;
}

function line(
  id: string,
  saleId: string,
  productId: string,
  units: number,
  costPerUnitKobo?: bigint,
): SaleLine {
  return {
    id,
    saleId,
    productId,
    unit: "UNIT",
    quantity: units,
    unitsPerPackSnapshot: 1,
    quantityUnits: units,
    unitPriceKobo: 0n,
    lineTotalKobo: 0n,
    ...(costPerUnitKobo === undefined ? {} : { costPerUnitKobo }),
  } as unknown as SaleLine;
}

function payment(id: string, saleId: string, amountKobo: bigint, paidAt: Date): SalePayment {
  return {
    id,
    saleId,
    accountId: "a1",
    amountKobo,
    paidAt,
    createdAt: paidAt,
  } as unknown as SalePayment;
}

function dayOf(result: ReturnType<typeof salesSummary>, date: string) {
  const day = result.days.find((d) => d.date === date);
  if (!day) throw new Error(`No summary day for ${date}`);
  return day;
}

describe("salesSummary profit follows the day of the sale", () => {
  it("does not add an old debt's collection to today's profit (the trophy example)", () => {
    const products = [product("old", 200000n), product("trophy", 830000n)];
    const sales = [
      sale("s1", OCT14, 240000n, 240000n), // N2,400 sold on 14th, paid in full since
      sale("s2", OCT15, 910000n, 910000n), // trophy N9,100 sold and paid on 15th
    ];
    const lines = [line("l1", "s1", "old", 1), line("l2", "s2", "trophy", 1)];
    const payments = [
      payment("p1", "s1", 240000n, OCT15_LATE), // old debt collected on 15th
      payment("p2", "s2", 910000n, OCT15),
    ];
    const result = salesSummary(FROM, TO, sales, lines, products, [], payments, new Set());

    // 14 Oct: revenue 240000 (paid share = all), cost = 200000 x 240000 / 240000 = 200000
    const d14 = dayOf(result, "2026-10-14");
    expect(d14.totalSupposedRevenueKobo).toBe(240000n);
    expect(d14.totalRevenueKobo).toBe(240000n);
    expect(d14.totalCogsKobo).toBe(200000n);
    expect(d14.totalGrossProfitKobo).toBe(40000n); // 240000 - 200000
    expect(d14.totalRevenueGottenKobo).toBe(0n); // nothing was received on the 14th

    // 15 Oct: trophy margin only. Cash received includes the old debt.
    const d15 = dayOf(result, "2026-10-15");
    expect(d15.totalRevenueKobo).toBe(910000n);
    expect(d15.totalCogsKobo).toBe(830000n);
    expect(d15.totalGrossProfitKobo).toBe(80000n); // 910000 - 830000, NOT 320000
    expect(d15.totalNetProfitKobo).toBe(80000n);
    expect(d15.totalRevenueGottenKobo).toBe(1150000n); // 240000 + 910000

    expect(result.totals.totalGrossProfitKobo).toBe(120000n); // 40000 + 80000
  });

  it("gives an old sale's collection no profit when the sale is outside the period", () => {
    const from = new Date("2026-10-14T23:00:00.000Z"); // 15 Oct only
    const sales = [sale("old", new Date("2026-10-10T08:00:00.000Z"), 100000n, 50000n)];
    const payments = [payment("p", "old", 50000n, OCT15)];
    const result = salesSummary(from, TO, sales, [], [], [], payments, new Set());

    const d15 = dayOf(result, "2026-10-15");
    expect(d15.totalRevenueGottenKobo).toBe(50000n); // cash is counted
    expect(d15.totalSupposedRevenueKobo).toBe(0n);
    expect(d15.totalRevenueKobo).toBe(0n);
    expect(d15.totalCogsKobo).toBe(0n);
    expect(d15.totalGrossProfitKobo).toBe(0n); // but no profit
  });

  it("shows no profit and no loss for a fully unpaid credit sale", () => {
    const result = salesSummary(
      FROM, TO,
      [sale("s", OCT15, 100000n, 0n)],
      [line("l", "s", "p", 1)],
      [product("p", 60000n)],
      [], [], new Set(),
    );
    const d = dayOf(result, "2026-10-15");
    expect(d.totalSupposedRevenueKobo).toBe(100000n);
    expect(d.totalRevenueKobo).toBe(0n);
    expect(d.totalCogsKobo).toBe(0n); // cost 60000 x 0 / 100000
    expect(d.totalGrossProfitKobo).toBe(0n); // not -60000
  });

  it("counts only the paid share of a part-paid sale", () => {
    const result = salesSummary(
      FROM, TO,
      [sale("s", OCT15, 100000n, 25000n)],
      [line("l", "s", "p", 1)],
      [product("p", 60000n)],
      [], [], new Set(),
    );
    const d = dayOf(result, "2026-10-15");
    expect(d.totalRevenueKobo).toBe(25000n);
    expect(d.totalCogsKobo).toBe(15000n); // 60000 x 25000 / 100000
    expect(d.totalGrossProfitKobo).toBe(10000n); // 25000 - 15000
  });

  it("rounds the cost of the paid share half up", () => {
    // cost 1, total 2, paid 1: 1 x 1 / 2 = 0.5 -> 1
    const half = salesSummary(
      FROM, TO,
      [sale("s", OCT15, 2n, 1n)],
      [line("l", "s", "p", 1)],
      [product("p", 1n)],
      [], [], new Set(),
    );
    expect(dayOf(half, "2026-10-15").totalCogsKobo).toBe(1n);
    expect(dayOf(half, "2026-10-15").totalGrossProfitKobo).toBe(0n); // 1 - 1

    // cost 100, total 300, paid 100: 100 x 100 / 300 = 33.33 -> 33
    const third = salesSummary(
      FROM, TO,
      [sale("s", OCT15, 300n, 100n)],
      [line("l", "s", "p", 1)],
      [product("p", 100n)],
      [], [], new Set(),
    );
    expect(dayOf(third, "2026-10-15").totalCogsKobo).toBe(33n);
    expect(dayOf(third, "2026-10-15").totalGrossProfitKobo).toBe(67n); // 100 - 33
  });

  it("ignores voided sales and their payments completely", () => {
    const result = salesSummary(
      FROM, TO,
      [sale("v", OCT15, 50000n, 50000n, "VOIDED")],
      [line("l", "v", "p", 1)],
      [product("p", 30000n)],
      [], [payment("pv", "v", 50000n, OCT15)], new Set(),
    );
    expect(result.days).toEqual([]);
    expect(result.totals.totalGrossProfitKobo).toBe(0n);
    expect(result.totals.totalRevenueGottenKobo).toBe(0n);
  });

  it("does not count a reversed payment as cash or as profit", () => {
    // Paid 100000 then reversed: the sale's paidKobo is back to 0.
    const result = salesSummary(
      FROM, TO,
      [sale("s", OCT15, 100000n, 0n)],
      [line("l", "s", "p", 1)],
      [product("p", 60000n)],
      [], [payment("pr", "s", 100000n, OCT15)], new Set(["pr"]),
    );
    const d = dayOf(result, "2026-10-15");
    expect(d.totalRevenueGottenKobo).toBe(0n);
    expect(d.totalRevenueKobo).toBe(0n);
    expect(d.totalGrossProfitKobo).toBe(0n);
    expect(d.totalSupposedRevenueKobo).toBe(100000n);
  });

  it("uses the cost captured on the sale line, not today's average cost", () => {
    // Sold 2 units when cost was 500 each; the product's average has since moved to 900.
    const captured = salesSummary(
      FROM, TO,
      [sale("s", OCT15, 3000n, 3000n)],
      [line("l", "s", "p", 2, 500n)],
      [product("p", 900n)],
      [], [], new Set(),
    );
    expect(dayOf(captured, "2026-10-15").totalCogsKobo).toBe(1000n); // 2 x 500
    expect(dayOf(captured, "2026-10-15").totalGrossProfitKobo).toBe(2000n); // 3000 - 1000

    // Without a captured cost the product's average cost is used.
    const fallback = salesSummary(
      FROM, TO,
      [sale("s", OCT15, 3000n, 3000n)],
      [line("l", "s", "p", 2)],
      [product("p", 900n)],
      [], [], new Set(),
    );
    expect(dayOf(fallback, "2026-10-15").totalCogsKobo).toBe(1800n); // 2 x 900
    expect(dayOf(fallback, "2026-10-15").totalGrossProfitKobo).toBe(1200n); // 3000 - 1800
  });
});