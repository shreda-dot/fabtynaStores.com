import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  accountBalanceOf,
  createHarness,
  deactivateAccount,
  newId,
  postSale,
  saleBody,
  seedAccount,
  seedCustomer,
  seedProduct,
  snapshot,
  stockOf,
  type Harness,
} from "./sales-fixtures.js";

let h!: Harness;
let atomicityHook: (() => Promise<void>) | null = null;

/**
 * A real Prisma client whose transaction hands the service a tx that, just
 * before the account entry is written, deactivates the account over a SEPARATE
 * connection. The database trigger then raises for real. No production code
 * knows about this.
 */
function wrapPrisma(prisma: PrismaClient): PrismaClient {
  return new Proxy(prisma, {
    get(target, prop) {
      if (prop === "$transaction") {
        return (fn: (tx: any) => Promise<unknown>, options: unknown) =>
          (target as any).$transaction(
            (tx: any) =>
              fn(
                new Proxy(tx, {
                  get(txTarget, txProp) {
                    if (txProp === "accountLedgerEntry") {
                      return {
                        createMany: async (args: unknown) => {
                          if (atomicityHook !== null) {
                            await atomicityHook();
                          }
                          return txTarget.accountLedgerEntry.createMany(args);
                        },
                      };
                    }
                    return Reflect.get(txTarget, txProp);
                  },
                }),
              ),
            options,
          );
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as PrismaClient;
}

beforeAll(async () => {
  h = await createHarness({ wrapPrisma });
});

afterAll(async () => {
  await h.close();
});

describe("POST /sales: money received", () => {
  it("1. fully paid walk-in retail sale into cash writes every row and moves stock and cash", async () => {
    const product = await seedProduct(h.pg, { stock: 10, averageCostKobo: 7000n });
    const account = await seedAccount(h.pg);
    const prefix = newId("t1");

    const res = await postSale(
      h.app,
      saleBody({
        productId: product.id,
        quantity: 2,
        paidKobo: "20000",
        accountId: account.id,
        reference: `${prefix}-a`,
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.totalKobo).toBe("20000");
    expect(res.body.paidKobo).toBe("20000");
    expect(res.body.status).toBe("COMPLETED");
    expect(res.body.createdById).toBe(h.actor.id);

    const saleId = res.body.id as string;
    const lines = await h.pg.query(`SELECT * FROM sale_lines WHERE "saleId" = $1`, [saleId]);
    expect(lines.rows).toHaveLength(1);
    expect(lines.rows[0].location).toBe("RETAIL_SHELF");
    expect(lines.rows[0].quantityUnits).toBe(2);
    // 12. cost snapshot equals the product's averageCostKobo at sale time
    expect(String(lines.rows[0].costPerUnitKobo)).toBe("7000");

    const moves = await h.pg.query(`SELECT * FROM stock_movements WHERE "saleLineId" = $1`, [lines.rows[0].id]);
    expect(moves.rows).toHaveLength(1);
    expect(moves.rows[0].quantityUnits).toBe(-2);

    const payments = await h.pg.query(`SELECT * FROM sale_payments WHERE "saleId" = $1`, [saleId]);
    expect(payments.rows).toHaveLength(1);
    expect(payments.rows[0].accountId).toBe(account.id);
    expect(String(payments.rows[0].amountKobo)).toBe("20000");

    const entries = await h.pg.query(`SELECT * FROM account_ledger_entries WHERE "salePaymentId" = $1`, [
      payments.rows[0].id,
    ]);
    expect(entries.rows).toHaveLength(1);
    expect(entries.rows[0].type).toBe("SALE_PAYMENT");
    expect(String(entries.rows[0].amountKobo)).toBe("20000");

    expect(await stockOf(h.pg, product.id)).toBe(8);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(20000n);

    const ledger = await h.pg.query(`SELECT 1 FROM customer_ledger_entries WHERE "saleId" = $1`, [saleId]);
    expect(ledger.rows).toHaveLength(0);

    // 12. audit row: actor, entity, after-data
    const audit = await h.pg.query(
      `SELECT "actorId", "entityType", "entityId", "afterData" FROM audit_logs WHERE action = 'sale.create' AND "entityId" = $1`,
      [saleId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].actorId).toBe(h.actor.id);
    expect(audit.rows[0].entityType).toBe("sale");
    expect(audit.rows[0].afterData.sale.totalKobo).toBe("20000");
    expect(audit.rows[0].afterData.payments[0].accountId).toBe(account.id);
  });

  it("2. credit sale to a customer posts the unpaid amount to the customer ledger and nothing to an account", async () => {
    const product = await seedProduct(h.pg, { stock: 10 });
    const customer = await seedCustomer(h.pg);
    const account = await seedAccount(h.pg);
    const res = await postSale(
      h.app,
      saleBody({ productId: product.id, quantity: 3, customerId: customer.id, reference: `${newId("t2")}-a` }),
    );
    expect(res.status).toBe(201);
    const ledger = await h.pg.query(`SELECT type, "amountKobo" FROM customer_ledger_entries WHERE "saleId" = $1`, [
      res.body.id,
    ]);
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0].type).toBe("SALE");
    expect(String(ledger.rows[0].amountKobo)).toBe("30000");
    expect(await accountBalanceOf(h.pg, account.id)).toBe(0n);
    const payments = await h.pg.query(`SELECT 1 FROM sale_payments WHERE "saleId" = $1`, [res.body.id]);
    expect(payments.rows).toHaveLength(0);
  });

  it("3. part-paid sale: ledger = unpaid portion, payment and account entry = paid portion", async () => {
    const product = await seedProduct(h.pg, { stock: 10 });
    const customer = await seedCustomer(h.pg);
    const account = await seedAccount(h.pg);
    const res = await postSale(
      h.app,
      saleBody({
        productId: product.id,
        quantity: 3,
        customerId: customer.id,
        paidKobo: "10000",
        accountId: account.id,
        reference: `${newId("t3")}-a`,
      }),
    );
    expect(res.status).toBe(201);
    const ledger = await h.pg.query(`SELECT "amountKobo" FROM customer_ledger_entries WHERE "saleId" = $1`, [
      res.body.id,
    ]);
    expect(String(ledger.rows[0].amountKobo)).toBe("20000");
    expect(await accountBalanceOf(h.pg, account.id)).toBe(10000n);
    const payments = await h.pg.query(`SELECT "amountKobo" FROM sale_payments WHERE "saleId" = $1`, [res.body.id]);
    expect(String(payments.rows[0].amountKobo)).toBe("10000");
  });

  it("4. a sale paid by transfer goes into the bank account", async () => {
    const product = await seedProduct(h.pg, { stock: 5 });
    const bank = await seedAccount(h.pg, { type: "BANK" });
    const res = await postSale(
      h.app,
      saleBody({ productId: product.id, quantity: 1, paidKobo: "10000", accountId: bank.id, reference: `${newId("t4")}-a` }),
    );
    expect(res.status).toBe(201);
    expect(await accountBalanceOf(h.pg, bank.id)).toBe(10000n);
  });
});

describe("POST /sales: quantities", () => {
  it("5. a wholesale half-pack resolves to whole units; a fraction that does not resolve is rejected", async () => {
    const product = await seedProduct(h.pg, { stock: 48, location: "WAREHOUSE", unitsPerPack: 24 });
    const account = await seedAccount(h.pg);
    const ok = await postSale(
      h.app,
      saleBody({
        productId: product.id,
        channel: "WHOLESALE",
        location: "WAREHOUSE",
        unit: "PACK",
        quantity: 0.5,
        unitPriceKobo: "200000",
        paidKobo: "100000",
        accountId: account.id,
        reference: `${newId("t5")}-a`,
      }),
    );
    expect(ok.status).toBe(201);
    expect(ok.body.totalKobo).toBe("100000");
    expect(await stockOf(h.pg, product.id, "WAREHOUSE")).toBe(36);
    const line = await h.pg.query(`SELECT quantity::text AS q, "quantityUnits" FROM sale_lines WHERE "saleId" = $1`, [
      ok.body.id,
    ]);
    expect(line.rows[0].q).toBe("0.5000");
    expect(line.rows[0].quantityUnits).toBe(12);

    const odd = await seedProduct(h.pg, { stock: 50, location: "WAREHOUSE", unitsPerPack: 5 });
    const prefix = newId("t5b");
    const before = await snapshot(h.pg, { productIds: [odd.id], prefix });
    const bad = await postSale(
      h.app,
      saleBody({
        productId: odd.id,
        channel: "WHOLESALE",
        location: "WAREHOUSE",
        unit: "PACK",
        quantity: 0.5,
        paidKobo: "1000",
        accountId: account.id,
        reference: `${prefix}-a`,
      }),
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION");
    expect(await snapshot(h.pg, { productIds: [odd.id], prefix })).toEqual(before);
  });
});

describe("POST /sales: rejected sales write nothing", () => {
  it("6. an unpaid walk-in sale is rejected with 400", async () => {
    const product = await seedProduct(h.pg, { stock: 5 });
    const prefix = newId("t6");
    const scope = { productIds: [product.id], prefix };
    const before = await snapshot(h.pg, scope);
    const res = await postSale(h.app, saleBody({ productId: product.id, reference: `${prefix}-a` }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION");
    expect(await snapshot(h.pg, scope)).toEqual(before);
  });

  it("7. insufficient stock: 409 naming the product and available quantity, nothing written", async () => {
    const product = await seedProduct(h.pg, { stock: 2, name: `Scarce ${newId("p")}` });
    const account = await seedAccount(h.pg);
    const prefix = newId("t7");
    const scope = { productIds: [product.id], accountId: account.id, prefix };
    const before = await snapshot(h.pg, scope);
    const res = await postSale(
      h.app,
      saleBody({ productId: product.id, quantity: 5, paidKobo: "50000", accountId: account.id, reference: `${prefix}-a` }),
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_STOCK");
    expect(res.body.error.message).toContain(product.name);
    expect(res.body.error.details.availableUnits).toBe(2);
    expect(res.body.error.details.requestedUnits).toBe(5);
    expect(await snapshot(h.pg, scope)).toEqual(before);
  });

  it("7b. two lines for one product and location that together exceed stock: 409, nothing written", async () => {
    const product = await seedProduct(h.pg, { stock: 5, name: `Twice ${newId("p")}` });
    const account = await seedAccount(h.pg);
    const prefix = newId("t7b");
    const scope = { productIds: [product.id], accountId: account.id, prefix };
    const before = await snapshot(h.pg, scope);
    const res = await postSale(
      h.app,
      saleBody({
        productId: product.id,
        lines: [
          { productId: product.id, quantity: 3 },
          { productId: product.id, quantity: 3 },
        ],
        paidKobo: "60000",
        accountId: account.id,
        reference: `${prefix}-a`,
      }),
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_STOCK");
    expect(res.body.error.message).toContain(product.name);
    expect(res.body.error.details.availableUnits).toBe(5);
    expect(res.body.error.details.requestedUnits).toBe(6);
    expect(await snapshot(h.pg, scope)).toEqual(before);
  });

  it("8. atomicity: a REAL failure after sale, lines, movements and payment were inserted leaves nothing", async () => {
    const product = await seedProduct(h.pg, { stock: 5 });
    const customer = await seedCustomer(h.pg);
    const account = await seedAccount(h.pg);
    const prefix = newId("t8");
    const scope = { productIds: [product.id], customerId: customer.id, accountId: account.id, prefix };
    const before = await snapshot(h.pg, scope);

    // The account is valid when the service checks it and deactivated before its entry is written.
    atomicityHook = async () => {
      await deactivateAccount(h.pg, account.id);
    };
    let res;
    try {
      res = await postSale(
        h.app,
        saleBody({
          productId: product.id,
          quantity: 2,
          customerId: customer.id,
          paidKobo: "10000",
          accountId: account.id,
          reference: `${prefix}-a`,
        }),
      );
    } finally {
      atomicityHook = null;
    }
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("BUSINESS_RULE");
    expect(res.body.error.message).toContain("deactivated");
    expect(await snapshot(h.pg, scope)).toEqual(before);
    expect(await stockOf(h.pg, product.id)).toBe(5);
  });

  it("11. a duplicate reference returns 409 and writes nothing more", async () => {
    const product = await seedProduct(h.pg, { stock: 10 });
    const account = await seedAccount(h.pg);
    const prefix = newId("t11");
    const scope = { productIds: [product.id], accountId: account.id, prefix };
    const body = saleBody({ productId: product.id, paidKobo: "10000", accountId: account.id, reference: `${prefix}-a` });
    expect((await postSale(h.app, body)).status).toBe(201);
    const afterFirst = await snapshot(h.pg, scope);
    const second = await postSale(h.app, body);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("CONFLICT");
    expect(await snapshot(h.pg, scope)).toEqual(afterFirst);
  });
});

describe("POST /sales: input validation added by the service", () => {
  it("rejects a future soldAt but tolerates 5 minutes of clock drift", async () => {
    const product = await seedProduct(h.pg, { stock: 10 });
    const account = await seedAccount(h.pg);
    const prefix = newId("tfut");
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const bad = await postSale(
      h.app,
      saleBody({ productId: product.id, paidKobo: "10000", accountId: account.id, soldAt: future, reference: `${prefix}-a` }),
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toContain("future");

    const drift = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    const ok = await postSale(
      h.app,
      saleBody({ productId: product.id, paidKobo: "10000", accountId: account.id, soldAt: drift, reference: `${prefix}-b` }),
    );
    expect(ok.status).toBe(201);
  });

  it("rejects a deactivated customer, product and account, and unknown ones", async () => {
    const account = await seedAccount(h.pg);
    const product = await seedProduct(h.pg, { stock: 10 });
    const prefix = newId("tdeact");

    const deadCustomer = await seedCustomer(h.pg, { deactivated: true });
    const c = await postSale(
      h.app,
      saleBody({ productId: product.id, customerId: deadCustomer.id, reference: `${prefix}-c` }),
    );
    expect(c.status).toBe(409);
    expect(c.body.error.code).toBe("BUSINESS_RULE");
    expect(c.body.error.message).toContain(deadCustomer.name);

    const deadProduct = await seedProduct(h.pg, { stock: 10, deactivated: true });
    const p = await postSale(
      h.app,
      saleBody({ productId: deadProduct.id, paidKobo: "10000", accountId: account.id, reference: `${prefix}-p` }),
    );
    expect(p.status).toBe(409);
    expect(p.body.error.message).toContain(deadProduct.name);

    const deadAccount = await seedAccount(h.pg);
    await deactivateAccount(h.pg, deadAccount.id);
    const a = await postSale(
      h.app,
      saleBody({ productId: product.id, paidKobo: "10000", accountId: deadAccount.id, reference: `${prefix}-a` }),
    );
    expect(a.status).toBe(409);
    expect(a.body.error.message).toContain(deadAccount.name);

    const noCustomer = await postSale(
      h.app,
      saleBody({ productId: product.id, customerId: newId("ghost"), reference: `${prefix}-nc` }),
    );
    expect(noCustomer.status).toBe(400);
    const noProduct = await postSale(
      h.app,
      saleBody({ productId: newId("ghost"), paidKobo: "10000", accountId: account.id, reference: `${prefix}-np` }),
    );
    expect(noProduct.status).toBe(400);
    const noAccount = await postSale(
      h.app,
      saleBody({ productId: product.id, paidKobo: "10000", accountId: newId("ghost"), reference: `${prefix}-na` }),
    );
    expect(noAccount.status).toBe(400);
    const missingAccount = await postSale(
      h.app,
      saleBody({ productId: product.id, paidKobo: "10000", reference: `${prefix}-ma` }),
    );
    expect(missingAccount.status).toBe(400);
  });

  it("rejects a product that is not sold in the sale's channel, and a location that does not fit the channel", async () => {
    const account = await seedAccount(h.pg);
    const wholesaleOnly = await seedProduct(h.pg, { stock: 10, saleChannel: "WHOLESALE" });
    const prefix = newId("tchan");
    const channel = await postSale(
      h.app,
      saleBody({ productId: wholesaleOnly.id, paidKobo: "10000", accountId: account.id, reference: `${prefix}-a` }),
    );
    expect(channel.status).toBe(400);
    expect(channel.body.error.message).toContain(wholesaleOnly.name);

    const product = await seedProduct(h.pg, { stock: 10, location: "WAREHOUSE" });
    const location = await postSale(
      h.app,
      saleBody({
        productId: product.id,
        channel: "RETAIL",
        location: "WAREHOUSE",
        paidKobo: "10000",
        accountId: account.id,
        reference: `${prefix}-b`,
      }),
    );
    expect(location.status).toBe(400);
    expect(location.body.error.details.field).toBe("location");
  });

  it("rejects a client reference that looks like a generated one", async () => {
    const product = await seedProduct(h.pg, { stock: 10 });
    const account = await seedAccount(h.pg);
    const res = await postSale(
      h.app,
      saleBody({ productId: product.id, paidKobo: "10000", accountId: account.id, reference: "S-20260101-000123" }),
    );
    expect(res.status).toBe(400);
    expect(res.body.error.details.field).toBe("reference");
  });

  it("generates a reference S-YYYYMMDD-NNNNNN when none is supplied", async () => {
    const product = await seedProduct(h.pg, { stock: 10 });
    const account = await seedAccount(h.pg);
    const res = await postSale(
      h.app,
      saleBody({ productId: product.id, paidKobo: "10000", accountId: account.id }),
    );
    expect(res.status).toBe(201);
    expect(res.body.reference).toMatch(/^S-\d{8}-\d{6,}$/);
  });
});

describe("POST /sales: transaction timing", () => {
  it("reports the duration of a 1-line and a 5-line sale", async () => {
    const account = await seedAccount(h.pg);
    const products = await Promise.all([1, 2, 3, 4, 5].map(() => seedProduct(h.pg, { stock: 20 })));

    const timed = async (lineCount: number): Promise<number> => {
      const started = performance.now();
      const res = await postSale(
        h.app,
        saleBody({
          productId: products[0]!.id,
          lines: products.slice(0, lineCount).map((p) => ({ productId: p.id, quantity: 1 })),
          paidKobo: String(lineCount * 10000),
          accountId: account.id,
        }),
      );
      expect(res.status).toBe(201);
      return Math.round(performance.now() - started);
    };

    await timed(1); // warm the pool
    const one = await timed(1);
    const five = await timed(5);
    console.log(`SALE TIMING (test db, via inject): 1 line = ${one} ms, 5 lines = ${five} ms`);
    expect(one).toBeLessThan(15_000);
    expect(five).toBeLessThan(15_000);
  });
});
