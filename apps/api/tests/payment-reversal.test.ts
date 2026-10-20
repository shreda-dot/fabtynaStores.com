import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  accountBalanceOf,
  call,
  createHarness,
  fundAccount,
  newId,
  postPurchase,
  postSale,
  purchaseBody,
  saleBody,
  seedAccount,
  seedBlankProduct,
  seedCustomer,
  seedProduct,
  seedSupplier,
  stockOf,
  type Harness,
} from "./sales-fixtures.js";

let h!: Harness;

// Several tests chain many round trips to Neon.
vi.setConfig({ testTimeout: 180_000 });

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

const now = () => new Date().toISOString();
const api = (method: "GET" | "POST" | "PUT", url: string, body?: unknown, headers: Record<string, string> = {}) =>
  call(h.app, method, url, body, headers);

async function customerBalance(customerId: string): Promise<bigint> {
  const { rows } = await h.pg.query(
    `SELECT COALESCE(sum("amountKobo"), 0)::text AS n FROM customer_ledger_entries WHERE "customerId" = $1`,
    [customerId],
  );
  return BigInt(rows[0].n as string);
}

async function supplierBalance(supplierId: string): Promise<bigint> {
  const { rows } = await h.pg.query(
    `SELECT COALESCE(sum("amountKobo"), 0)::text AS n FROM supplier_ledger_entries WHERE "supplierId" = $1`,
    [supplierId],
  );
  return BigInt(rows[0].n as string);
}

async function paid(table: "sales" | "purchases", id: string): Promise<string> {
  const { rows } = await h.pg.query(`SELECT "paidKobo"::text AS p FROM ${table} WHERE id = $1`, [id]);
  return rows[0].p as string;
}

async function status(table: "sales" | "purchases", id: string): Promise<string> {
  const { rows } = await h.pg.query(`SELECT status FROM ${table} WHERE id = $1`, [id]);
  return rows[0].status as string;
}

/** A credit sale to a customer, then a later payment into a fresh account. */
async function saleWithLaterPayment(amount = "4000") {
  const product = await seedProduct(h.pg, { stock: 10 });
  const customer = await seedCustomer(h.pg);
  const account = await seedAccount(h.pg);
  const sale = await postSale(
    h.app,
    saleBody({ productId: product.id, quantity: 3, customerId: customer.id, paidKobo: "0", reference: newId("rev-sale") }),
  );
  expect(sale.status).toBe(201);
  const pay = await api("POST", `/sales/${sale.body.id}/payments`, {
    amountKobo: amount,
    accountId: account.id,
    paidAt: now(),
  });
  expect(pay.status).toBe(201);
  return { product, customer, account, saleId: sale.body.id as string, paymentId: pay.body.payment.id as string };
}

const reverseSale = (saleId: string, paymentId: string, body: Record<string, unknown> = { reason: "Entered twice" }, headers = {}) =>
  api("POST", `/sales/${saleId}/payments/${paymentId}/reverse`, body, headers);

const reversePurchase = (id: string, paymentId: string, body: Record<string, unknown> = { reason: "Wrong supplier" }, headers = {}) =>
  api("POST", `/purchases/${id}/payments/${paymentId}/reverse`, body, headers);

/** A supplier purchase of 10 units for 10000, with `paidNow` paid at receipt from a funded account. */
async function supplierPurchase(paidNow: string) {
  const product = await seedBlankProduct(h.pg);
  const supplier = await seedSupplier(h.pg);
  const account = await seedAccount(h.pg);
  await fundAccount(h.pg, account.id, 50000n);
  const res = await postPurchase(
    h.app,
    purchaseBody({
      productId: product.id,
      supplierId: supplier.id,
      amountPaidNowKobo: paidNow,
      accountId: paidNow === "0" ? null : account.id,
      paymentMethod: paidNow === "0" ? undefined : "CASH",
      reference: newId("rev-purch"),
    }),
  );
  expect(res.status).toBe(201);
  const purchaseId = res.body.id as string;
  return { product, supplier, account, purchaseId };
}

async function purchasePaymentIds(purchaseId: string): Promise<string[]> {
  const { rows } = await h.pg.query(`SELECT id FROM supplier_payments WHERE "purchaseId" = $1 ORDER BY "createdAt"`, [purchaseId]);
  return rows.map((row) => row.id as string);
}

describe("POST /sales/:id/payments/:paymentId/reverse", () => {
  it("legal: reverses a later payment and restores customer, account and paidKobo", async () => {
    const { customer, account, saleId, paymentId } = await saleWithLaterPayment("4000");
    expect(await customerBalance(customer.id)).toBe(26000n);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(4000n);

    h.txLog.length = 0;
    const res = await reverseSale(saleId, paymentId, { reason: "Paid by mistake" });
    expect(res.status).toBe(201);
    expect(res.body.reversedPaymentId).toBe(paymentId);
    console.log(`STATEMENTS sale payment reverse: ${h.txLog.at(-1)?.queries}`);

    expect(await customerBalance(customer.id)).toBe(30000n);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(0n);
    expect(await paid("sales", saleId)).toBe("0");

    const entry = await h.pg.query(
      `SELECT "amountKobo"::text AS amount, note FROM account_ledger_entries WHERE "salePaymentId" = $1 AND "reversesEntryId" IS NOT NULL`,
      [paymentId],
    );
    expect(entry.rows).toEqual([{ amount: "-4000", note: "Paid by mistake" }]);
    const audit = await h.pg.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE action = 'sale.payment.reverse' AND "entityId" = $1`,
      [saleId],
    );
    expect(audit.rows[0].n).toBe(1);

    const detail = await api("GET", `/sales/${saleId}`);
    expect(detail.body.payments[0].reversed).toBe(true);
    expect(detail.body.livePaymentsKobo).toBe("0");
    expect(detail.body.balanceDueKobo).toBe("30000");
  });

  it("forbidden: an empty reason is rejected and nothing changes", async () => {
    const { account, saleId, paymentId } = await saleWithLaterPayment();
    const res = await reverseSale(saleId, paymentId, { reason: "   " });
    expect(res.status).toBe(400);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(4000n);
    expect(await paid("sales", saleId)).toBe("4000");
  });

  it("forbidden: a walk-in sale payment cannot be reversed (void instead)", async () => {
    const product = await seedProduct(h.pg, { stock: 5 });
    const account = await seedAccount(h.pg);
    const sale = await postSale(
      h.app,
      saleBody({ productId: product.id, quantity: 1, paidKobo: "10000", accountId: account.id, reference: newId("rev-walkin") }),
    );
    expect(sale.status).toBe(201);
    const { rows } = await h.pg.query(`SELECT id FROM sale_payments WHERE "saleId" = $1`, [sale.body.id]);
    const res = await reverseSale(sale.body.id, rows[0].id as string);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/void/i);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(10000n);
  });

  it("forbidden: an up-front payment cannot be reversed (void/amend instead)", async () => {
    const product = await seedProduct(h.pg, { stock: 5 });
    const customer = await seedCustomer(h.pg);
    const account = await seedAccount(h.pg);
    const sale = await postSale(
      h.app,
      saleBody({
        productId: product.id,
        quantity: 2,
        customerId: customer.id,
        paidKobo: "5000",
        accountId: account.id,
        reference: newId("rev-upfront"),
      }),
    );
    expect(sale.status).toBe(201);
    const { rows } = await h.pg.query(`SELECT id FROM sale_payments WHERE "saleId" = $1`, [sale.body.id]);
    const res = await reverseSale(sale.body.id, rows[0].id as string);
    expect(res.status).toBe(409);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(5000n);
    expect(await paid("sales", sale.body.id)).toBe("5000");
  });

  it("forbidden: reversing twice is refused", async () => {
    const { saleId, paymentId, account } = await saleWithLaterPayment();
    expect((await reverseSale(saleId, paymentId)).status).toBe(201);
    const again = await reverseSale(saleId, paymentId);
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/already/i);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(0n);
  });

  it("forbidden: refused with the friendly overdraw message when the cash was already spent", async () => {
    const { saleId, paymentId, account } = await saleWithLaterPayment("5000");
    await h.pg.query(
      `INSERT INTO account_ledger_entries (id, "accountId", type, "amountKobo", note)
       VALUES ($1, $2, 'OWNER_DRAWING', -5000, 'spent')`,
      [newId("rev_draw"), account.id],
    );
    const res = await reverseSale(saleId, paymentId);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain(account.name);
    expect(await paid("sales", saleId)).toBe("5000");
  });

  it("void and amend are refused while the payment is live, and work after it is reversed", async () => {
    const { product, customer, account, saleId, paymentId } = await saleWithLaterPayment("4000");
    const blockedVoid = await api("POST", `/sales/${saleId}/void`);
    expect(blockedVoid.status).toBe(409);
    expect(blockedVoid.body.error.message).toMatch(/reverse the payment/i);
    const blockedAmend = await api(
      "PUT",
      `/sales/${saleId}`,
      saleBody({ productId: product.id, quantity: 1, customerId: customer.id, reference: newId("rev-amend") }),
    );
    expect(blockedAmend.status).toBe(409);

    expect((await reverseSale(saleId, paymentId)).status).toBe(201);
    expect(await stockOf(h.pg, product.id)).toBe(7);

    const amended = await api(
      "PUT",
      `/sales/${saleId}`,
      saleBody({ productId: product.id, quantity: 1, customerId: customer.id, reference: newId("rev-amend2") }),
    );
    expect(amended.status).toBe(200);
    expect(await stockOf(h.pg, product.id)).toBe(9);
    expect(await status("sales", saleId)).toBe("VOIDED");
    expect(await accountBalanceOf(h.pg, account.id)).toBe(0n);
    expect(await customerBalance(customer.id)).toBe(10000n);

    const second = await saleWithLaterPayment("1000");
    expect((await reverseSale(second.saleId, second.paymentId)).status).toBe(201);
    expect((await api("POST", `/sales/${second.saleId}/void`)).status).toBe(200);
    expect(await stockOf(h.pg, second.product.id)).toBe(10);
    expect(await customerBalance(second.customer.id)).toBe(0n);
  });

  it("idempotent retry reverses once and replays with the header", async () => {
    const { saleId, paymentId, account } = await saleWithLaterPayment();
    const key = newId("idem-rev");
    const first = await reverseSale(saleId, paymentId, { reason: "retry" }, { "idempotency-key": key });
    const second = await reverseSale(saleId, paymentId, { reason: "retry" }, { "idempotency-key": key });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(await accountBalanceOf(h.pg, account.id)).toBe(0n);
  });

  it("database guard: a direct void is rejected while a payment is live and accepted once reversed", async () => {
    const { saleId, paymentId } = await saleWithLaterPayment();
    const attempt = async () => {
      await h.pg.query("BEGIN");
      try {
        await h.pg.query(`UPDATE sales SET status = 'VOIDED' WHERE id = $1`, [saleId]);
      } finally {
        await h.pg.query("ROLLBACK");
      }
    };
    await expect(attempt()).rejects.toThrow();
    expect((await reverseSale(saleId, paymentId)).status).toBe(201);
    await expect(attempt()).resolves.toBeUndefined();
  });

  it("voiding a sale whose account was deactivated returns the friendly 409", async () => {
    const product = await seedProduct(h.pg, { stock: 5 });
    const account = await seedAccount(h.pg);
    const sale = await postSale(
      h.app,
      saleBody({ productId: product.id, quantity: 1, paidKobo: "10000", accountId: account.id, reference: newId("rev-deact") }),
    );
    expect(sale.status).toBe(201);
    // An account can only be deactivated at zero, so the money is spent first.
    await h.pg.query(
      `INSERT INTO account_ledger_entries (id, "accountId", type, "amountKobo", note)
       VALUES ($1, $2, 'OWNER_DRAWING', -10000, 'spent')`,
      [newId("rev_draw"), account.id],
    );
    await h.pg.query(`UPDATE accounts SET "isActive" = false, "deactivatedAt" = now() WHERE id = $1`, [account.id]);
    try {
      const res = await api("POST", `/sales/${sale.body.id}/void`);
      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain(account.name);
      expect(res.body.error.message).toMatch(/deactivated/i);
      expect(await status("sales", sale.body.id)).toBe("COMPLETED");
    } finally {
      await h.pg.query(`UPDATE accounts SET "isActive" = true, "deactivatedAt" = NULL WHERE id = $1`, [account.id]);
    }
  });
});

describe("POST /purchases/:id/payments/:paymentId/reverse", () => {
  it("legal: reverses a payment made at receipt, then void succeeds", async () => {
    const { product, supplier, account, purchaseId } = await supplierPurchase("4000");
    const [paymentId] = await purchasePaymentIds(purchaseId);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(46000n);
    expect(await supplierBalance(supplier.id)).toBe(6000n);

    const blocked = await api("POST", `/purchases/${purchaseId}/void`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toContain("Reverse the payments first");

    h.txLog.length = 0;
    const res = await reversePurchase(purchaseId, paymentId, { reason: "Wrong account" });
    expect(res.status).toBe(201);
    console.log(`STATEMENTS purchase payment reverse: ${h.txLog.at(-1)?.queries}`);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(50000n);
    expect(await supplierBalance(supplier.id)).toBe(10000n);
    expect(await paid("purchases", purchaseId)).toBe("0");

    const note = await h.pg.query(
      `SELECT note FROM account_ledger_entries WHERE "supplierPaymentId" = $1 AND "reversesEntryId" IS NOT NULL`,
      [paymentId],
    );
    expect(note.rows).toEqual([{ note: "Wrong account" }]);

    const detail = await api("GET", `/purchases/${purchaseId}`);
    expect(detail.body.payments[0].reversed).toBe(true);
    expect(detail.body.livePaymentsKobo).toBe("0");
    expect(detail.body.balanceDueKobo).toBe("10000");

    expect((await api("POST", `/purchases/${purchaseId}/void`)).status).toBe(200);
    expect(await stockOf(h.pg, product.id, "WAREHOUSE")).toBe(0);
    expect(await supplierBalance(supplier.id)).toBe(0n);
  });

  it("legal: reverses a later payment, then amend succeeds", async () => {
    const { product, supplier, account, purchaseId } = await supplierPurchase("0");
    const pay = await api("POST", `/purchases/${purchaseId}/payments`, {
      amountKobo: "3000",
      accountId: account.id,
      method: "CASH",
      paidAt: now(),
    });
    expect(pay.status).toBe(201);
    const amendBody = purchaseBody({
      productId: product.id,
      supplierId: supplier.id,
      quantity: 5,
      lineTotalKobo: "5000",
      reference: newId("rev-purch-amend"),
    });
    expect((await api("PUT", `/purchases/${purchaseId}`, amendBody)).status).toBe(409);

    expect((await reversePurchase(purchaseId, pay.body.payment.id)).status).toBe(201);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(50000n);

    const amended = await api("PUT", `/purchases/${purchaseId}`, amendBody);
    expect(amended.status).toBe(200);
    expect(await status("purchases", purchaseId)).toBe("VOIDED");
    expect(await stockOf(h.pg, product.id, "WAREHOUSE")).toBe(5);
    expect(await supplierBalance(supplier.id)).toBe(5000n);
  });

  it("forbidden: reversing twice and an empty reason are refused", async () => {
    const { purchaseId, account } = await supplierPurchase("2000");
    const [paymentId] = await purchasePaymentIds(purchaseId);
    expect((await reversePurchase(purchaseId, paymentId, { reason: "" })).status).toBe(400);
    expect((await reversePurchase(purchaseId, paymentId)).status).toBe(201);
    const again = await reversePurchase(purchaseId, paymentId);
    expect(again.status).toBe(409);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(50000n);
  });

  it("idempotent retry reverses once and replays with the header", async () => {
    const { purchaseId, account } = await supplierPurchase("2000");
    const [paymentId] = await purchasePaymentIds(purchaseId);
    const key = newId("idem-prev");
    const first = await reversePurchase(purchaseId, paymentId, { reason: "retry" }, { "idempotency-key": key });
    const second = await reversePurchase(purchaseId, paymentId, { reason: "retry" }, { "idempotency-key": key });
    expect(first.status).toBe(201);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(await accountBalanceOf(h.pg, account.id)).toBe(50000n);
  });

  it("database guard: a direct void is rejected while a payment is live and accepted once reversed", async () => {
    const { purchaseId } = await supplierPurchase("2000");
    const [paymentId] = await purchasePaymentIds(purchaseId);
    const attempt = async () => {
      await h.pg.query("BEGIN");
      try {
        await h.pg.query(`UPDATE purchases SET status = 'VOIDED' WHERE id = $1`, [purchaseId]);
      } finally {
        await h.pg.query("ROLLBACK");
      }
    };
    await expect(attempt()).rejects.toThrow();
    expect((await reversePurchase(purchaseId, paymentId)).status).toBe(201);
    await expect(attempt()).resolves.toBeUndefined();
  });

  it("concurrency: two simultaneous reversals of one payment, exactly one succeeds (10 runs)", async () => {
    for (let i = 0; i < 10; i += 1) {
      const { purchaseId, account } = await supplierPurchase("2000");
      const [paymentId] = await purchasePaymentIds(purchaseId);
      const results = await Promise.all([
        reversePurchase(purchaseId, paymentId, { reason: "race a" }),
        reversePurchase(purchaseId, paymentId, { reason: "race b" }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await accountBalanceOf(h.pg, account.id)).toBe(50000n);
      expect(await paid("purchases", purchaseId)).toBe("0");
    }
  });
});
