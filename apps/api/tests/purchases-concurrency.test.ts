import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  accountBalanceOf,
  averageCostOf,
  call,
  createHarness,
  fundAccount,
  postPurchase,
  purchaseBody,
  seedAccount,
  seedBlankProduct,
  seedSupplier,
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

const ITERATIONS = 10;

describe("purchase concurrency", () => {
  it("two simultaneous purchases of one product give the sequential average cost (10 runs)", async () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const product = await seedBlankProduct(h.pg);
      const supplier = await seedSupplier(h.pg);
      const results = await Promise.all([
        postPurchase(h.app, purchaseBody({ productId: product.id, supplierId: supplier.id, quantity: 10, lineTotalKobo: "10000" })),
        postPurchase(h.app, purchaseBody({ productId: product.id, supplierId: supplier.id, quantity: 5, lineTotalKobo: "10000" })),
      ]);
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      expect(await stockOf(h.pg, product.id, "WAREHOUSE")).toBe(15);
      // Sequentially: 10 @1000 then 5 more for 10000 total = 20000 / 15 units = 1333; the other order gives the same.
      expect(await averageCostOf(h.pg, product.id)).toBe(1333n);
    }
  }, 300_000);

  it("two simultaneous payments from an account that can afford only one: exactly one succeeds (10 runs)", async () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const supplier = await seedSupplier(h.pg);
      const account = await seedAccount(h.pg);
      await fundAccount(h.pg, account.id, 5000n);
      const ids: string[] = [];
      for (let n = 0; n < 2; n += 1) {
        const product = await seedBlankProduct(h.pg);
        const created = await postPurchase(h.app, purchaseBody({ productId: product.id, supplierId: supplier.id, lineTotalKobo: "5000" }));
        expect(created.status).toBe(201);
        ids.push(created.body.id);
      }
      const paidAt = new Date().toISOString();
      const results = await Promise.all(
        ids.map((id) =>
          call(h.app, "POST", `/purchases/${id}/payments`, { amountKobo: "5000", accountId: account.id, method: "CASH", paidAt }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await accountBalanceOf(h.pg, account.id)).toBe(0n);
    }
  }, 600_000);

  it("two simultaneous voids of one purchase: exactly one succeeds (10 runs)", async () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const product = await seedBlankProduct(h.pg);
      const supplier = await seedSupplier(h.pg);
      const created = await postPurchase(h.app, purchaseBody({ productId: product.id, supplierId: supplier.id }));
      const results = await Promise.all([
        call(h.app, "POST", `/purchases/${created.body.id}/void`),
        call(h.app, "POST", `/purchases/${created.body.id}/void`),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await stockOf(h.pg, product.id, "WAREHOUSE")).toBe(0);
      expect(await averageCostOf(h.pg, product.id)).toBe(0n);
    }
  }, 600_000);
});
