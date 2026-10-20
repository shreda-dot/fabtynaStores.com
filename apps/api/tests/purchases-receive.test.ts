import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  accountBalanceOf,
  averageCostOf,
  createHarness,
  fundAccount,
  newId,
  postPurchase,
  purchaseBody,
  seedAccount,
  seedBlankProduct,
  seedProduct,
  seedSupplier,
  deactivateAccount,
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

const rows = async (sql: string, params: unknown[]) => (await h.pg.query(sql, params)).rows;
const countRows = async (sql: string, params: unknown[]) => Number((await rows(sql, params))[0].n);

/** Counts what ONE test owns: its product's movements and its reference-prefixed purchases. */
async function ownedCounts(productId: string, prefix: string) {
  return {
    purchases: await countRows(`SELECT count(*) AS n FROM purchases WHERE reference LIKE $1`, [`${prefix}%`]),
    lines: await countRows(`SELECT count(*) AS n FROM purchase_lines WHERE "productId" = $1`, [productId]),
    movements: await countRows(`SELECT count(*) AS n FROM stock_movements WHERE "productId" = $1`, [productId]),
  };
}

describe("POST /purchases", () => {
  it("records a credit purchase with a supplier: no money moves and a zero-balance account is untouched", async () => {
    const product = await seedBlankProduct(h.pg);
    const supplier = await seedSupplier(h.pg);
    const account = await seedAccount(h.pg);

    const res = await postPurchase(
      h.app,
      purchaseBody({ productId: product.id, supplierId: supplier.id, quantity: 10, lineTotalKobo: "10000", dueDate: "2030-01-31" }),
    );

    expect(res.status).toBe(201);
    expect(res.body.reference).toMatch(/^P-\d{8}-\d{6,}$/);
    expect(res.body.status).toBe("RECEIVED");
    expect(res.body.totalKobo).toBe("10000");
    expect(res.body.paidKobo).toBe("0");
    expect(await stockOf(h.pg, product.id, "WAREHOUSE")).toBe(10);
    expect(await averageCostOf(h.pg, product.id)).toBe(1000n);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(0n);

    const ledger = await rows(
      `SELECT type::text AS type, "amountKobo"::text AS amount FROM supplier_ledger_entries WHERE "purchaseId" = $1`,
      [res.body.id],
    );
    expect(ledger).toEqual([{ type: "PURCHASE", amount: "10000" }]);
    expect(await countRows(`SELECT count(*) AS n FROM account_ledger_entries WHERE "purchaseId" = $1`, [res.body.id])).toBe(0);
    expect(await countRows(`SELECT count(*) AS n FROM audit_logs WHERE action = 'purchase.create' AND "entityId" = $1`, [res.body.id])).toBe(1);

    console.log("STATEMENTS POST /purchases (credit, 1 line):", h.txLog.at(-1)?.queries);
  });

  it("records a part-paid purchase: supplier payment, both ledger entries, account entry and average cost", async () => {
    const product = await seedBlankProduct(h.pg);
    const supplier = await seedSupplier(h.pg);
    const account = await seedAccount(h.pg);
    await fundAccount(h.pg, account.id, 20000n);

    const res = await postPurchase(
      h.app,
      purchaseBody({
        productId: product.id,
        supplierId: supplier.id,
        quantity: 10,
        lineTotalKobo: "10000",
        amountPaidNowKobo: "4000",
        accountId: account.id,
        paymentMethod: "TRANSFER",
      }),
    );

    expect(res.status).toBe(201);
    expect(res.body.paidKobo).toBe("4000");
    expect(await accountBalanceOf(h.pg, account.id)).toBe(16000n);
    expect(await averageCostOf(h.pg, product.id)).toBe(1000n);

    const payments = await rows(
      `SELECT "amountKobo"::text AS amount, method::text AS method, "accountId" FROM supplier_payments WHERE "purchaseId" = $1`,
      [res.body.id],
    );
    expect(payments).toEqual([{ amount: "4000", method: "TRANSFER", accountId: account.id }]);
    const ledger = await rows(
      `SELECT type::text AS type, "amountKobo"::text AS amount FROM supplier_ledger_entries
        WHERE "supplierId" = $1 ORDER BY "amountKobo" DESC`,
      [supplier.id],
    );
    expect(ledger).toEqual([
      { type: "PURCHASE", amount: "10000" },
      { type: "PAYMENT", amount: "-4000" },
    ]);
    const entries = await rows(
      `SELECT type::text AS type, "amountKobo"::text AS amount FROM account_ledger_entries
        WHERE "accountId" = $1 AND type <> 'OWNER_CAPITAL'`,
      [account.id],
    );
    expect(entries).toEqual([{ type: "SUPPLIER_PAYMENT", amount: "-4000" }]);

    console.log("STATEMENTS POST /purchases (part-paid, 1 line):", h.txLog.at(-1)?.queries);
  });

  it("records a fully paid supplier-less purchase as a PURCHASE_PAYMENT account entry only", async () => {
    const product = await seedBlankProduct(h.pg);
    const account = await seedAccount(h.pg);
    await fundAccount(h.pg, account.id, 15000n);

    const res = await postPurchase(
      h.app,
      purchaseBody({
        productId: product.id,
        quantity: 10,
        lineTotalKobo: "10000",
        amountPaidNowKobo: "10000",
        accountId: account.id,
      }),
    );

    expect(res.status).toBe(201);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(5000n);
    const entries = await rows(
      `SELECT type::text AS type, "amountKobo"::text AS amount, "purchaseId" FROM account_ledger_entries
        WHERE "accountId" = $1 AND type <> 'OWNER_CAPITAL'`,
      [account.id],
    );
    expect(entries).toEqual([{ type: "PURCHASE_PAYMENT", amount: "-10000", purchaseId: res.body.id }]);
    expect(await countRows(`SELECT count(*) AS n FROM supplier_payments WHERE "purchaseId" = $1`, [res.body.id])).toBe(0);
    expect(await countRows(`SELECT count(*) AS n FROM supplier_ledger_entries WHERE "purchaseId" = $1`, [res.body.id])).toBe(0);
  });

  it("refuses money the account cannot afford, naming the account, and writes nothing", async () => {
    const product = await seedBlankProduct(h.pg);
    const supplier = await seedSupplier(h.pg);
    const account = await seedAccount(h.pg);
    await fundAccount(h.pg, account.id, 1000n);
    const prefix = newId("purch_overspend");
    const before = await ownedCounts(product.id, prefix);

    const res = await postPurchase(
      h.app,
      purchaseBody({
        productId: product.id,
        supplierId: supplier.id,
        reference: `${prefix}-1`,
        amountPaidNowKobo: "5000",
        accountId: account.id,
      }),
    );

    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain(account.name);
    expect(res.body.error.message).toContain("record income or reconcile first");
    expect(await ownedCounts(product.id, prefix)).toEqual(before);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(1000n);
  });

  it("rejects an unpaid purchase without a supplier", async () => {
    const product = await seedBlankProduct(h.pg);
    const prefix = newId("purch_nosup");
    const before = await ownedCounts(product.id, prefix);

    const res = await postPurchase(
      h.app,
      purchaseBody({ productId: product.id, reference: `${prefix}-1`, amountPaidNowKobo: "0" }),
    );

    expect(res.status).toBe(400);
    expect(await ownedCounts(product.id, prefix)).toEqual(before);
  });

  it("rejects a deactivated supplier, product and account", async () => {
    const product = await seedBlankProduct(h.pg);
    const supplier = await seedSupplier(h.pg);
    const account = await seedAccount(h.pg);
    await fundAccount(h.pg, account.id, 50000n);
    const deadSupplier = await seedSupplier(h.pg, { deactivated: true });
    const deadProduct = await seedProduct(h.pg, { deactivated: true, averageCostKobo: 0n });
    const deadAccount = await seedAccount(h.pg);
    await deactivateAccount(h.pg, deadAccount.id);

    const supplierRes = await postPurchase(h.app, purchaseBody({ productId: product.id, supplierId: deadSupplier.id }));
    expect(supplierRes.status).toBe(409);
    expect(supplierRes.body.error.message).toContain(deadSupplier.name);

    const productRes = await postPurchase(h.app, purchaseBody({ productId: deadProduct.id, supplierId: supplier.id }));
    expect(productRes.status).toBe(409);
    expect(productRes.body.error.message).toContain(deadProduct.name);

    const accountRes = await postPurchase(
      h.app,
      purchaseBody({ productId: product.id, amountPaidNowKobo: "10000", accountId: deadAccount.id }),
    );
    expect(accountRes.status).toBe(409);
    expect(accountRes.body.error.message).toContain(deadAccount.name);

    const okRes = await postPurchase(
      h.app,
      purchaseBody({ productId: product.id, supplierId: supplier.id, amountPaidNowKobo: "10000", accountId: account.id }),
    );
    expect(okRes.status).toBe(201);
  });

  it("accepts a fractional pack quantity that resolves to whole units and rejects one that does not", async () => {
    const product = await seedBlankProduct(h.pg, { unitsPerPack: 24 });
    const supplier = await seedSupplier(h.pg);

    const ok = await postPurchase(
      h.app,
      purchaseBody({ productId: product.id, supplierId: supplier.id, unit: "PACK", quantity: 0.5, lineTotalKobo: "12000" }),
    );
    expect(ok.status).toBe(201);
    expect(await stockOf(h.pg, product.id, "WAREHOUSE")).toBe(12);

    const bad = await postPurchase(
      h.app,
      purchaseBody({ productId: product.id, supplierId: supplier.id, unit: "PACK", quantity: 0.3, lineTotalKobo: "12000" }),
    );
    expect(bad.status).toBe(400);
    expect(await stockOf(h.pg, product.id, "WAREHOUSE")).toBe(12);
  });

  it("generates the reference, rejects look-alikes, rejects a future date and replays an idempotent retry once", async () => {
    const product = await seedBlankProduct(h.pg);
    const supplier = await seedSupplier(h.pg);
    const prefix = newId("purch_idem");
    const body = purchaseBody({ productId: product.id, supplierId: supplier.id, reference: `${prefix}-ref` });

    const lookAlike = await postPurchase(h.app, purchaseBody({ productId: product.id, supplierId: supplier.id, reference: "P-20260101-000001" }));
    expect(lookAlike.status).toBe(400);

    const future = await postPurchase(
      h.app,
      purchaseBody({ productId: product.id, supplierId: supplier.id, purchasedAt: new Date(Date.now() + 3_600_000).toISOString() }),
    );
    expect(future.status).toBe(400);

    const key = `${prefix}-key`;
    const first = await postPurchase(h.app, body, { "idempotency-key": key });
    const second = await postPurchase(h.app, body, { "idempotency-key": key });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.body.id).toBe(first.body.id);
    expect((await ownedCounts(product.id, prefix)).purchases).toBe(1);
    expect(await stockOf(h.pg, product.id, "WAREHOUSE")).toBe(10);

    const generated = await postPurchase(h.app, purchaseBody({ productId: product.id, supplierId: supplier.id }));
    expect(generated.body.reference).toMatch(/^P-\d{8}-\d{6,}$/);
    expect(generated.body.reference).not.toBe(first.body.reference);
  });
});
