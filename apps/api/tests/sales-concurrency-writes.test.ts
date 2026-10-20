import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createHarness,
  newId,
  postSale,
  saleBody,
  seedAccount,
  seedCustomer,
  seedProduct,
  type Harness,
} from "./sales-fixtures.js";

const ITERATIONS = 10;
let h!: Harness;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

const post = (url: string, payload?: unknown) =>
  h.app.inject({
    method: "POST",
    url,
    payload: payload as object | undefined,
    headers: payload === undefined ? {} : { "content-type": "application/json" },
  });

describe("sales write concurrency", () => {
  it(
    "two simultaneous payments that together exceed the balance: exactly one succeeds",
    async () => {
      for (let i = 0; i < ITERATIONS; i += 1) {
        const product = await seedProduct(h.pg, { stock: 5 });
        const customer = await seedCustomer(h.pg);
        const account = await seedAccount(h.pg);
        const sale = await postSale(
          h.app,
          saleBody({ productId: product.id, customerId: customer.id, paidKobo: "0", reference: `cpay-${newId("r")}` }),
        );
        expect(sale.status).toBe(201);

        const body = { amountKobo: "6000", accountId: account.id, paidAt: new Date().toISOString() };
        const results = await Promise.all([post(`/sales/${sale.body.id}/payments`, body), post(`/sales/${sale.body.id}/payments`, body)]);
        const statuses = results.map((r) => r.statusCode).sort();
        expect(statuses).toEqual([201, 400]);

        const { rows } = await h.pg.query(`SELECT "paidKobo"::text AS paid FROM sales WHERE id = $1`, [sale.body.id]);
        expect(rows[0].paid).toBe("6000");
      }
    },
    300_000,
  );

  it(
    "two simultaneous voids: exactly one succeeds",
    async () => {
      for (let i = 0; i < ITERATIONS; i += 1) {
        const product = await seedProduct(h.pg, { stock: 5 });
        const account = await seedAccount(h.pg);
        const sale = await postSale(
          h.app,
          saleBody({ productId: product.id, paidKobo: "10000", accountId: account.id, reference: `cvoid-${newId("r")}` }),
        );
        expect(sale.status).toBe(201);

        const results = await Promise.all([post(`/sales/${sale.body.id}/void`), post(`/sales/${sale.body.id}/void`)]);
        expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);

        const stock = await h.pg.query(
          `SELECT COALESCE(sum("quantityUnits"), 0)::int AS n FROM stock_balances WHERE "productId" = $1`,
          [product.id],
        );
        expect(stock.rows[0].n).toBe(5);
        const balance = await h.pg.query(
          `SELECT COALESCE(sum("amountKobo"), 0)::text AS n FROM account_ledger_entries WHERE "accountId" = $1`,
          [account.id],
        );
        expect(balance.rows[0].n).toBe("0");
      }
    },
    300_000,
  );
});
