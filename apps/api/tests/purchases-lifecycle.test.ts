import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  accountBalanceOf,
  averageCostOf,
  call,
  createHarness,
  deactivateAccount,
  fundAccount,
  newId,
  postPurchase,
  postSale,
  purchaseBody,
  saleBody,
  seedAccount,
  seedBlankProduct,
  seedCustomer,
  seedSupplier,
  stockOf,
  type Harness,
} from "./sales-fixtures.js";

let h!: Harness;
let accountEntryHook: ((call: number) => Promise<void>) | null = null;
let accountEntryCalls = 0;

/** Real failure injection: the hook deactivates an account over another connection just before an account-entry insert. */
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
                      return new Proxy(txTarget.accountLedgerEntry, {
                        get(entryTarget, entryProp) {
                          if (entryProp === "createMany") {
                            return async (args: unknown) => {
                              accountEntryCalls += 1;
                              if (accountEntryHook !== null) {
                                await accountEntryHook(accountEntryCalls);
                              }
                              return entryTarget.createMany(args);
                            };
                          }
                          const value = Reflect.get(entryTarget, entryProp, entryTarget);
                          return typeof value === "function" ? value.bind(entryTarget) : value;
                        },
                      });
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

const rows = async (sql: string, params: unknown[]) => (await h.pg.query(sql, params)).rows;
const countRows = async (sql: string, params: unknown[]) => Number((await rows(sql, params))[0].n);
const statusOf = async (purchaseId: string) =>
  (await rows(`SELECT status::text AS s FROM purchases WHERE id = $1`, [purchaseId]))[0].s as string;
const supplierBalance = async (supplierId: string) =>
  BigInt((await rows(`SELECT COALESCE(sum("amountKobo"), 0)::text AS b FROM supplier_ledger_entries WHERE "supplierId" = $1`, [supplierId]))[0].b);
const payBody = (accountId: string, amountKobo: string) => ({
  amountKobo,
  accountId,
  method: "CASH",
  paidAt: new Date().toISOString(),
});

/** A credit purchase of 10 units for 10000 from a fresh supplier. */
async function creditPurchase(productId: string, supplierId: string, extra: Record<string, unknown> = {}) {
  const res = await postPurchase(h.app, { ...purchaseBody({ productId, supplierId }), ...extra });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe("POST /purchases/:id/payments", () => {
  it("pays a supplier later: balance due, supplier ledger and account are updated", async () => {
    const product = await seedBlankProduct(h.pg);
    const supplier = await seedSupplier(h.pg);
    const account = await seedAccount(h.pg);
    await fundAccount(h.pg, account.id, 20000n);
    const id = await creditPurchase(product.id, supplier.id);

    const res = await call(h.app, "POST", `/purchases/${id}/payments`, payBody(account.id, "4000"));

    expect(res.status).toBe(201);
    expect(res.body.purchase.paidKobo).toBe("4000");
    expect(await supplierBalance(supplier.id)).toBe(6000n);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(16000n);
    const entry = await rows(
      `SELECT type::text AS type, "amountKobo"::text AS amount, "supplierPaymentId" FROM account_ledger_entries
        WHERE "accountId" = $1 AND type <> 'OWNER_CAPITAL'`,
      [account.id],
    );
    expect(entry).toEqual([{ type: "SUPPLIER_PAYMENT", amount: "-4000", supplierPaymentId: res.body.payment.id }]);
    expect(await countRows(`SELECT count(*) AS n FROM audit_logs WHERE action = 'purchase.payment' AND "entityId" = $1`, [id])).toBe(1);

    console.log("STATEMENTS POST /purchases/:id/payments:", h.txLog.at(-1)?.queries);
  });

  it("rejects an overpayment with the amount due, and refuses an account that cannot afford it", async () => {
    const product = await seedBlankProduct(h.pg);
    const supplier = await seedSupplier(h.pg);
    const rich = await seedAccount(h.pg);
    const poor = await seedAccount(h.pg);
    await fundAccount(h.pg, rich.id, 20000n);
    await fundAccount(h.pg, poor.id, 1000n);
    const id = await creditPurchase(product.id, supplier.id);

    const over = await call(h.app, "POST", `/purchases/${id}/payments`, payBody(rich.id, "10001"));
    expect(over.status).toBe(400);
    expect(over.body.error.details.amountDueKobo).toBe("10000");

    const broke = await call(h.app, "POST", `/purchases/${id}/payments`, payBody(poor.id, "5000"));
    expect(broke.status).toBe(409);
    expect(broke.body.error.message).toContain(poor.name);
    expect(broke.body.error.message).toContain("record income or reconcile first");
    expect(await accountBalanceOf(h.pg, poor.id)).toBe(1000n);
    expect(await countRows(`SELECT count(*) AS n FROM supplier_payments WHERE "purchaseId" = $1`, [id])).toBe(0);
  });

  it("refuses a payment on a fully paid or voided purchase and replays an idempotent retry once", async () => {
    const product = await seedBlankProduct(h.pg);
    const supplier = await seedSupplier(h.pg);
    const account = await seedAccount(h.pg);
    await fundAccount(h.pg, account.id, 50000n);
    const id = await creditPurchase(product.id, supplier.id);

    const key = newId("purch_pay_key");
    const retryBody = payBody(account.id, "10000");
    const first = await call(h.app, "POST", `/purchases/${id}/payments`, retryBody, { "idempotency-key": key });
    const replay = await call(h.app, "POST", `/purchases/${id}/payments`, retryBody, { "idempotency-key": key });
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(await countRows(`SELECT count(*) AS n FROM supplier_payments WHERE "purchaseId" = $1`, [id])).toBe(1);

    const again = await call(h.app, "POST", `/purchases/${id}/payments`, payBody(account.id, "1"));
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/fully paid/i);

    const voidable = await creditPurchase(product.id, supplier.id);
    expect((await call(h.app, "POST", `/purchases/${voidable}/void`)).status).toBe(200);
    const onVoided = await call(h.app, "POST", `/purchases/${voidable}/payments`, payBody(account.id, "1"));
    expect(onVoided.status).toBe(409);
    expect(onVoided.body.error.message).toMatch(/voided/i);
  }, 90_000);
});

describe("POST /purchases/:id/void", () => {
  it("voids a credit purchase: stock, supplier ledger and average cost are restored", async () => {
    const product = await seedBlankProduct(h.pg);
    const supplier = await seedSupplier(h.pg);
    await creditPurchase(product.id, supplier.id); // 10 @ 1000
    const second = await postPurchase(
      h.app,
      purchaseBody({ productId: product.id, supplierId: supplier.id, quantity: 10, lineTotalKobo: "20000" }),
    );
    expect(await averageCostOf(h.pg, product.id)).toBe(1500n);

    const res = await call(h.app, "POST", `/purchases/${second.body.id}/void`);

    expect(res.status).toBe(200);
    expect(await statusOf(second.body.id)).toBe("VOIDED");
    expect(await stockOf(h.pg, product.id, "WAREHOUSE")).toBe(10);
    expect(await averageCostOf(h.pg, product.id)).toBe(1000n);
    expect(await supplierBalance(supplier.id)).toBe(10000n);
    expect(await countRows(`SELECT count(*) AS n FROM audit_logs WHERE action = 'purchase.void' AND "entityId" = $1`, [second.body.id])).toBe(1);

    const twice = await call(h.app, "POST", `/purchases/${second.body.id}/void`);
    expect(twice.status).toBe(409);
    expect(twice.body.error.message).toMatch(/already been voided/i);

    console.log("STATEMENTS POST /purchases/:id/void:", h.txLog.at(-2)?.queries);
  });

  it("voids a paid supplier-less purchase and puts the money back, even when the account is empty", async () => {
    const product = await seedBlankProduct(h.pg);
    const account = await seedAccount(h.pg);
    await fundAccount(h.pg, account.id, 10000n);
    const created = await postPurchase(
      h.app,
      purchaseBody({ productId: product.id, amountPaidNowKobo: "10000", accountId: account.id }),
    );
    expect(await accountBalanceOf(h.pg, account.id)).toBe(0n);

    const res = await call(h.app, "POST", `/purchases/${created.body.id}/void`);

    expect(res.status).toBe(200);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(10000n);
    expect(await stockOf(h.pg, product.id, "WAREHOUSE")).toBe(0);
    const reversal = await rows(
      `SELECT type::text AS type, "amountKobo"::text AS amount FROM account_ledger_entries
        WHERE "accountId" = $1 AND "reversesEntryId" IS NOT NULL`,
      [account.id],
    );
    expect(reversal).toEqual([{ type: "PURCHASE_PAYMENT", amount: "10000" }]);
  });

  it("refuses to void when any supplier payment exists", async () => {
    const product = await seedBlankProduct(h.pg);
    const supplier = await seedSupplier(h.pg);
    const account = await seedAccount(h.pg);
    await fundAccount(h.pg, account.id, 10000n);
    const created = await postPurchase(
      h.app,
      purchaseBody({ productId: product.id, supplierId: supplier.id, amountPaidNowKobo: "3000", accountId: account.id }),
    );

    const res = await call(h.app, "POST", `/purchases/${created.body.id}/void`);

    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain("Reverse the payments first");
    expect(await statusOf(created.body.id)).toBe("RECEIVED");
    expect(await stockOf(h.pg, product.id, "WAREHOUSE")).toBe(10);
  });

  it("refuses with the friendly message when the stock was already sold, and changes nothing", async () => {
    const product = await seedBlankProduct(h.pg);
    const supplier = await seedSupplier(h.pg);
    const customer = await seedCustomer(h.pg, { type: "WHOLESALE" });
    const id = await creditPurchase(product.id, supplier.id);
    const sold = await postSale(
      h.app,
      saleBody({ productId: product.id, quantity: 4, channel: "WHOLESALE", location: "WAREHOUSE", customerId: customer.id }),
    );
    expect(sold.status).toBe(201);

    const res = await call(h.app, "POST", `/purchases/${id}/void`);

    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain(product.name);
    expect(res.body.error.message).toContain("already been sold or moved");
    expect(res.body.error.details.onHandUnits).toBe(6);
    expect(res.body.error.details.neededUnits).toBe(10);
    expect(await statusOf(id)).toBe("RECEIVED");
    expect(await stockOf(h.pg, product.id, "WAREHOUSE")).toBe(6);
  });
});

describe("PUT /purchases/:id (amend)", () => {
  it("voids the original and records the replacement with a new reference, linked in the audit log", async () => {
    const product = await seedBlankProduct(h.pg);
    const supplier = await seedSupplier(h.pg);
    const original = await postPurchase(h.app, purchaseBody({ productId: product.id, supplierId: supplier.id }));

    const res = await call(
      h.app,
      "PUT",
      `/purchases/${original.body.id}`,
      purchaseBody({ productId: product.id, supplierId: supplier.id, quantity: 20, lineTotalKobo: "30000" }),
    );

    expect(res.status).toBe(200);
    expect(res.body.voidedPurchaseId).toBe(original.body.id);
    expect(res.body.purchase.id).not.toBe(original.body.id);
    expect(res.body.purchase.reference).not.toBe(original.body.reference);
    expect(await statusOf(original.body.id)).toBe("VOIDED");
    expect(await statusOf(res.body.purchase.id)).toBe("RECEIVED");
    expect(await stockOf(h.pg, product.id, "WAREHOUSE")).toBe(20);
    expect(await averageCostOf(h.pg, product.id)).toBe(1500n);
    expect(await supplierBalance(supplier.id)).toBe(30000n);
    expect(
      await countRows(
        `SELECT count(*) AS n FROM audit_logs WHERE action = 'purchase.create' AND "entityId" = $1 AND metadata->>'amendedFromPurchaseId' = $2`,
        [res.body.purchase.id, original.body.id],
      ),
    ).toBe(1);

    console.log("STATEMENTS PUT /purchases/:id:", h.txLog.at(-1)?.queries);
  });

  it("is atomic: a real failure in the second half leaves everything unchanged", async () => {
    const product = await seedBlankProduct(h.pg);
    const account = await seedAccount(h.pg);
    await fundAccount(h.pg, account.id, 10000n);
    const original = await postPurchase(
      h.app,
      purchaseBody({ productId: product.id, amountPaidNowKobo: "10000", accountId: account.id }),
    );
    expect(await accountBalanceOf(h.pg, account.id)).toBe(0n);

    // Entry insert 1 is the void's reversal; just before insert 2 (the replacement payment) the account is deactivated.
    accountEntryCalls = 0;
    accountEntryHook = async (n) => {
      if (n === 2) await deactivateAccount(h.pg, account.id);
    };
    let res;
    try {
      res = await call(
        h.app,
        "PUT",
        `/purchases/${original.body.id}`,
        purchaseBody({ productId: product.id, amountPaidNowKobo: "10000", accountId: account.id }),
      );
    } finally {
      accountEntryHook = null;
      // Leave the shared test database audit-clean: an account with entries must not stay deactivated.
      await h.pg.query(`UPDATE accounts SET "isActive" = true, "deactivatedAt" = NULL WHERE id = $1`, [account.id]);
    }

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await statusOf(original.body.id)).toBe("RECEIVED");
    expect(await countRows(`SELECT count(*) AS n FROM purchase_lines WHERE "productId" = $1`, [product.id])).toBe(1);
    expect(await stockOf(h.pg, product.id, "WAREHOUSE")).toBe(10);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(0n);
    expect(await countRows(`SELECT count(*) AS n FROM account_ledger_entries WHERE "accountId" = $1`, [account.id])).toBe(2);
  }, 90_000);

  it("refuses to amend a purchase that has a supplier payment", async () => {
    const product = await seedBlankProduct(h.pg);
    const supplier = await seedSupplier(h.pg);
    const account = await seedAccount(h.pg);
    await fundAccount(h.pg, account.id, 10000n);
    const original = await postPurchase(
      h.app,
      purchaseBody({ productId: product.id, supplierId: supplier.id, amountPaidNowKobo: "3000", accountId: account.id }),
    );

    const res = await call(
      h.app,
      "PUT",
      `/purchases/${original.body.id}`,
      purchaseBody({ productId: product.id, supplierId: supplier.id }),
    );

    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain("Reverse the payments first");
    expect(await statusOf(original.body.id)).toBe("RECEIVED");
    expect(await countRows(`SELECT count(*) AS n FROM purchase_lines WHERE "productId" = $1`, [product.id])).toBe(1);
  });
});
