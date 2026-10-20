import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDbAudit } from "../src/db/audit.js";
import { purgeExpiredIdempotencyKeys } from "../src/lib/idempotency.js";
import {
  accountBalanceOf,
  connectionString,
  createHarness,
  newId,
  postSale,
  saleBody,
  seedAccount,
  seedProduct,
  snapshot,
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

const RACE_ITERATIONS = 10;

describe("POST /sales: concurrency", () => {
  it(
    "9. two parallel requests for the last unit: exactly one 201 and one 409, stock never negative (10 rounds)",
    async () => {
      const account = await seedAccount(h.pg);
      let paidSales = 0;

      for (let round = 0; round < RACE_ITERATIONS; round += 1) {
        const product = await seedProduct(h.pg, { stock: 1 });
        const prefix = newId(`race${round}`);
        const attempt = (suffix: string) =>
          postSale(
            h.app,
            saleBody({
              productId: product.id,
              quantity: 1,
              paidKobo: "10000",
              accountId: account.id,
              reference: `${prefix}-${suffix}`,
            }),
          );
        const results = await Promise.all([attempt("a"), attempt("b")]);
        const statuses = results.map((r) => r.status).sort();
        expect(statuses).toEqual([201, 409]);
        const loser = results.find((r) => r.status === 409)!;
        expect(loser.body.error.code).toBe("INSUFFICIENT_STOCK");

        expect(await stockOf(h.pg, product.id)).toBe(0);
        paidSales += 1;
      }

      expect(await accountBalanceOf(h.pg, account.id)).toBe(BigInt(paidSales) * 10000n);
    },
    600_000,
  );

  it("leaves the test database audit-clean after the races", async () => {
    const audit = await runDbAudit(connectionString);
    expect(audit.checks.filter((c) => c.rowCount > 0 || c.error !== undefined)).toEqual([]);
  });
});

describe("POST /sales: idempotency", () => {
  async function fixture(stock = 10) {
    const product = await seedProduct(h.pg, { stock });
    const account = await seedAccount(h.pg);
    const prefix = newId("idem");
    return { product, account, prefix, scope: { productIds: [product.id], accountId: account.id, prefix } };
  }

  it("10a. the same key and body replays the stored response and creates one sale", async () => {
    const { product, account, prefix, scope } = await fixture();
    const body = saleBody({ productId: product.id, paidKobo: "10000", accountId: account.id, reference: `${prefix}-a` });
    const key = `${prefix}-key1`;

    const first = await postSale(h.app, body, { "idempotency-key": key });
    expect(first.status).toBe(201);
    expect(first.headers["idempotent-replayed"]).toBeUndefined();

    const second = await postSale(h.app, body, { "idempotency-key": key });
    expect(second.status).toBe(201);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.body).toEqual(first.body);

    const counts = await snapshot(h.pg, scope);
    expect(counts.sales).toBe(1);
    expect(counts.accountEntries).toBe(1);
    expect(counts.idempotencyKeys).toBe(1);
    expect(await stockOf(h.pg, product.id)).toBe(9);
  });

  it("10b. the same key with a different body returns 422 and changes nothing", async () => {
    const { product, account, prefix, scope } = await fixture();
    const key = `${prefix}-key2`;
    const first = await postSale(
      h.app,
      saleBody({ productId: product.id, paidKobo: "10000", accountId: account.id, reference: `${prefix}-a` }),
      { "idempotency-key": key },
    );
    expect(first.status).toBe(201);
    const before = await snapshot(h.pg, scope);

    const other = await postSale(
      h.app,
      saleBody({ productId: product.id, quantity: 2, paidKobo: "20000", accountId: account.id, reference: `${prefix}-b` }),
      { "idempotency-key": key },
    );
    expect(other.status).toBe(422);
    expect(other.body.error.code).toBe("IDEMPOTENCY_MISMATCH");
    expect(await snapshot(h.pg, scope)).toEqual(before);
  });

  it("10c. two simultaneous requests with one key create one sale and one account entry", async () => {
    for (let round = 0; round < 5; round += 1) {
      const { product, account, prefix, scope } = await fixture();
      const body = saleBody({ productId: product.id, paidKobo: "10000", accountId: account.id, reference: `${prefix}-a` });
      const key = `${prefix}-key3`;
      const [a, b] = await Promise.all([
        postSale(h.app, body, { "idempotency-key": key }),
        postSale(h.app, body, { "idempotency-key": key }),
      ]);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body.id).toBe(b.body.id);
      expect([a.headers["idempotent-replayed"], b.headers["idempotent-replayed"]].filter(Boolean)).toEqual(["true"]);

      const counts = await snapshot(h.pg, scope);
      expect(counts.sales).toBe(1);
      expect(counts.salePayments).toBe(1);
      expect(counts.accountEntries).toBe(1);
      expect(await accountBalanceOf(h.pg, account.id)).toBe(10000n);
    }
  }, 120_000);

  it("a failed request releases its key so the client can retry after fixing the problem", async () => {
    const { product, account, prefix, scope } = await fixture(1);
    const key = `${prefix}-key4`;
    const body = saleBody({ productId: product.id, quantity: 3, paidKobo: "30000", accountId: account.id, reference: `${prefix}-a` });
    const failed = await postSale(h.app, body, { "idempotency-key": key });
    expect(failed.status).toBe(409);
    expect((await snapshot(h.pg, scope)).idempotencyKeys).toBe(0);

    await h.pg.query(
      `INSERT INTO stock_movements (id, "productId", location, type, "quantityUnits", "unitCostKobo", "returnLineId")
       VALUES ($1, $2, 'RETAIL_SHELF', 'PURCHASE', 5, 0::bigint, $3)`,
      [newId("restock"), product.id, newId("restock_src")],
    );
    const retried = await postSale(h.app, body, { "idempotency-key": key });
    expect(retried.status).toBe(201);
  });

  it("rejects a malformed Idempotency-Key with 400", async () => {
    const { product, account, prefix } = await fixture();
    const res = await postSale(
      h.app,
      saleBody({ productId: product.id, paidKobo: "10000", accountId: account.id, reference: `${prefix}-a` }),
      { "idempotency-key": "short" },
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION");
  });

  it("the periodic cleanup removes only expired keys", async () => {
    const prefix = newId("purge");
    const expired = `${prefix}-old`;
    const live = `${prefix}-live`;
    await h.prisma.idempotencyKey.createMany({
      data: [
        { id: newId("ik"), key: expired, route: "POST /sales", requestHash: "x", expiresAt: new Date(Date.now() - 60_000) },
        { id: newId("ik"), key: live, route: "POST /sales", requestHash: "x", expiresAt: new Date(Date.now() + 3_600_000) },
      ],
    });
    const removed = await purgeExpiredIdempotencyKeys(h.prisma);
    expect(removed).toBeGreaterThanOrEqual(1);
    const left = await h.pg.query(`SELECT key FROM idempotency_keys WHERE key LIKE $1`, [`${prefix}%`]);
    expect(left.rows.map((r) => r.key)).toEqual([live]);
  });

  it("leaves the test database audit-clean", async () => {
    const audit = await runDbAudit(connectionString);
    expect(audit.checks.filter((c) => c.rowCount > 0 || c.error !== undefined)).toEqual([]);
  });
});
