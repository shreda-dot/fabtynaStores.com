import { buildAccountLedgerEntry } from "@fabtyna/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  accountBalanceOf,
  createHarness,
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

async function call(method: "POST" | "PUT" | "GET", url: string, payload?: unknown, headers: Record<string, string> = {}) {
  const response = await h.app.inject({
    method,
    url,
    payload: payload as object | undefined,
    headers: payload === undefined ? headers : { "content-type": "application/json", ...headers },
  });
  return { status: response.statusCode, body: response.json() as Record<string, any>, headers: response.headers };
}

async function fund(pg: Client, accountId: string, kobo: bigint) {
  await pg.query(
    `INSERT INTO account_ledger_entries (id, "accountId", type, "amountKobo")
     VALUES ($1, $2, 'OWNER_CAPITAL', $3::bigint)`,
    [newId("sales_fund"), accountId, kobo.toString()],
  );
}

async function customerBalance(customerId: string): Promise<bigint> {
  const { rows } = await h.pg.query(
    `SELECT COALESCE(sum("amountKobo"), 0)::text AS n FROM customer_ledger_entries WHERE "customerId" = $1`,
    [customerId],
  );
  return BigInt(rows[0].n as string);
}

async function saleRow(id: string) {
  const { rows } = await h.pg.query(`SELECT status, "paidKobo"::text AS paid FROM sales WHERE id = $1`, [id]);
  return rows[0] as { status: string; paid: string };
}

async function counts(saleId: string) {
  const one = async (sql: string) => Number((await h.pg.query(sql, [saleId])).rows[0].n);
  return {
    reversalMovements: await one(
      `SELECT count(*) AS n FROM stock_movements WHERE "reversesEntryId" IN (SELECT id FROM stock_movements WHERE "saleLineId" IN (SELECT id FROM sale_lines WHERE "saleId" = $1))`,
    ),
    payments: await one(`SELECT count(*) AS n FROM sale_payments WHERE "saleId" = $1`),
  };
}

const paidAtNow = () => new Date().toISOString();

async function creditSale(opts: { customerId: string; productId: string; quantity?: number; prefix: string }) {
  const res = await postSale(
    h.app,
    saleBody({
      productId: opts.productId,
      quantity: opts.quantity ?? 1,
      customerId: opts.customerId,
      paidKobo: "0",
      reference: `${opts.prefix}-credit-${newId("r")}`,
    }),
  );
  expect(res.status).toBe(201);
  return res.body;
}

describe("POST /sales/:id/payments", () => {
  it("legal: a debtor payment updates paidKobo, customer ledger and account balance", async () => {
    const product = await seedProduct(h.pg, { stock: 10 });
    const customer = await seedCustomer(h.pg);
    const account = await seedAccount(h.pg);
    const sale = await creditSale({ customerId: customer.id, productId: product.id, quantity: 3, prefix: "pay1" });
    expect(await customerBalance(customer.id)).toBe(30000n);

    h.txLog.length = 0;
    const res = await call("POST", `/sales/${sale.id}/payments`, {
      amountKobo: "12000",
      accountId: account.id,
      paidAt: paidAtNow(),
    });
    expect(res.status).toBe(201);
    expect(res.body.sale.paidKobo).toBe("12000");
    expect(res.body.payment.amountKobo).toBe("12000");
    expect(await customerBalance(customer.id)).toBe(18000n);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(12000n);
    expect((await saleRow(sale.id)).paid).toBe("12000");

    const ledgerRow = await h.pg.query(
      `SELECT "saleId" FROM customer_ledger_entries WHERE "customerId" = $1 AND type = 'PAYMENT'`,
      [customer.id],
    );
    expect(ledgerRow.rows).toHaveLength(1);
    expect(ledgerRow.rows[0].saleId).toBeNull();
    console.log(`STATEMENTS payment: ${h.txLog.at(-1)?.queries}`);

    const audit = await h.pg.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'sale.payment' AND "entityId" = $1`, [sale.id]);
    expect(audit.rows[0].n).toBe(1);
  });

  it("forbidden: overpaying returns 400 with the amount due and writes nothing", async () => {
    const product = await seedProduct(h.pg, { stock: 10 });
    const customer = await seedCustomer(h.pg);
    const account = await seedAccount(h.pg);
    const sale = await creditSale({ customerId: customer.id, productId: product.id, prefix: "pay2" });

    const res = await call("POST", `/sales/${sale.id}/payments`, {
      amountKobo: "10001",
      accountId: account.id,
      paidAt: paidAtNow(),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION");
    expect(res.body.error.details.amountDueKobo).toBe("10000");
    expect(await accountBalanceOf(h.pg, account.id)).toBe(0n);
    expect((await counts(sale.id)).payments).toBe(0);
  });

  it("forbidden: a payment on a fully paid sale, a voided sale, or with a future date is refused", async () => {
    const product = await seedProduct(h.pg, { stock: 10 });
    const customer = await seedCustomer(h.pg);
    const account = await seedAccount(h.pg);
    const sale = await creditSale({ customerId: customer.id, productId: product.id, prefix: "pay3" });
    const pay = (id: string, paidAt = paidAtNow()) =>
      call("POST", `/sales/${id}/payments`, { amountKobo: "10000", accountId: account.id, paidAt });

    const future = await pay(sale.id, new Date(Date.now() + 3_600_000).toISOString());
    expect(future.status).toBe(400);

    expect((await pay(sale.id)).status).toBe(201);
    const again = await pay(sale.id);
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/fully paid/i);

    const fresh = await creditSale({ customerId: customer.id, productId: product.id, prefix: "pay3b" });
    expect((await call("POST", `/sales/${fresh.id}/void`)).status).toBe(200);
    const onVoided = await pay(fresh.id);
    expect(onVoided.status).toBe(409);
    expect(onVoided.body.error.message).toMatch(/voided/i);
  });

  it("forbidden: a deactivated account cannot receive the payment", async () => {
    const product = await seedProduct(h.pg, { stock: 10 });
    const customer = await seedCustomer(h.pg);
    const account = await seedAccount(h.pg);
    await h.pg.query(`UPDATE accounts SET "isActive" = false, "deactivatedAt" = now() WHERE id = $1`, [account.id]);
    const sale = await creditSale({ customerId: customer.id, productId: product.id, prefix: "pay4" });
    const res = await call("POST", `/sales/${sale.id}/payments`, {
      amountKobo: "1000",
      accountId: account.id,
      paidAt: paidAtNow(),
    });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain(account.name);
  });

  it("idempotent retry creates one payment and replays with the header", async () => {
    const product = await seedProduct(h.pg, { stock: 10 });
    const customer = await seedCustomer(h.pg);
    const account = await seedAccount(h.pg);
    const sale = await creditSale({ customerId: customer.id, productId: product.id, prefix: "pay5" });
    const key = newId("idem-pay");
    const body = { amountKobo: "4000", accountId: account.id, paidAt: paidAtNow() };

    const first = await call("POST", `/sales/${sale.id}/payments`, body, { "idempotency-key": key });
    const second = await call("POST", `/sales/${sale.id}/payments`, body, { "idempotency-key": key });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.body.payment.id).toBe(first.body.payment.id);
    expect((await counts(sale.id)).payments).toBe(1);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(4000n);
  });
});

describe("POST /sales/:id/void", () => {
  it("legal: voiding a paid cash sale restores stock, customer ledger and account", async () => {
    const product = await seedProduct(h.pg, { stock: 10 });
    const customer = await seedCustomer(h.pg);
    const account = await seedAccount(h.pg);
    const created = await postSale(
      h.app,
      saleBody({
        productId: product.id,
        quantity: 4,
        customerId: customer.id,
        paidKobo: "25000",
        accountId: account.id,
        reference: `void1-${newId("r")}`,
      }),
    );
    expect(created.status).toBe(201);
    expect(await stockOf(h.pg, product.id)).toBe(6);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(25000n);
    expect(await customerBalance(customer.id)).toBe(15000n);

    h.txLog.length = 0;
    const res = await call("POST", `/sales/${created.body.id}/void`);
    expect(res.status).toBe(200);
    expect(res.body.sale.status).toBe("VOIDED");
    expect(await stockOf(h.pg, product.id)).toBe(10);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(0n);
    expect(await customerBalance(customer.id)).toBe(0n);
    expect((await saleRow(created.body.id)).paid).toBe("25000");
    console.log(`STATEMENTS void: ${h.txLog.at(-1)?.queries}`);

    const detail = await call("GET", `/sales/${created.body.id}`);
    expect(detail.body.payments[0].reversed).toBe(true);
  });

  it("forbidden: voiding twice returns the friendly 409", async () => {
    const product = await seedProduct(h.pg, { stock: 5 });
    const customer = await seedCustomer(h.pg);
    const sale = await creditSale({ customerId: customer.id, productId: product.id, prefix: "void2" });
    expect((await call("POST", `/sales/${sale.id}/void`)).status).toBe(200);
    const again = await call("POST", `/sales/${sale.id}/void`);
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/already been voided/i);
  });

  it("forbidden: voiding is refused when an on-account payment exists", async () => {
    const product = await seedProduct(h.pg, { stock: 5 });
    const customer = await seedCustomer(h.pg);
    const account = await seedAccount(h.pg);
    const sale = await creditSale({ customerId: customer.id, productId: product.id, prefix: "void3" });
    await call("POST", `/sales/${sale.id}/payments`, { amountKobo: "2000", accountId: account.id, paidAt: paidAtNow() });
    const res = await call("POST", `/sales/${sale.id}/void`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/reverse the payments first/i);
    expect((await saleRow(sale.id)).status).toBe("COMPLETED");
  });

  it("forbidden: voiding is refused with the overdraw message when the cash was already spent", async () => {
    const product = await seedProduct(h.pg, { stock: 5 });
    const account = await seedAccount(h.pg);
    const created = await postSale(
      h.app,
      saleBody({ productId: product.id, quantity: 2, paidKobo: "20000", accountId: account.id, reference: `void4-${newId("r")}` }),
    );
    expect(created.status).toBe(201);
    const spend = buildAccountLedgerEntry(
      { accountId: account.id, type: "OWNER_DRAWING", amountKobo: -15000n, note: "Owner took cash", occurredAt: new Date() },
      () => newId("sales_spend"),
    );
    await h.pg.query(
      `INSERT INTO account_ledger_entries (id, "accountId", type, "amountKobo", note)
       VALUES ($1, $2, 'OWNER_DRAWING', $3::bigint, $4)`,
      [spend.id, account.id, spend.amountKobo.toString(), spend.note],
    );

    const res = await call("POST", `/sales/${created.body.id}/void`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("BUSINESS_RULE");
    expect(res.body.error.message).toContain(account.name);
    expect(res.body.error.message).toMatch(/record income or reconcile first/i);
    expect((await saleRow(created.body.id)).status).toBe("COMPLETED");
    expect(await stockOf(h.pg, product.id)).toBe(3);
  });
});

describe("PUT /sales/:id (amend)", () => {
  it("legal: the original is voided and the replacement has a new reference", async () => {
    const product = await seedProduct(h.pg, { stock: 10 });
    const account = await seedAccount(h.pg);
    const created = await postSale(
      h.app,
      saleBody({ productId: product.id, quantity: 2, paidKobo: "20000", accountId: account.id, reference: `amd1-${newId("r")}` }),
    );
    expect(created.status).toBe(201);

    h.txLog.length = 0;
    const res = await call(
      "PUT",
      `/sales/${created.body.id}`,
      saleBody({ productId: product.id, quantity: 3, paidKobo: "30000", accountId: account.id }),
    );
    expect(res.status).toBe(200);
    expect(res.body.voidedSaleId).toBe(created.body.id);
    expect(res.body.sale.id).not.toBe(created.body.id);
    expect(res.body.sale.reference).not.toBe(created.body.reference);
    expect((await saleRow(created.body.id)).status).toBe("VOIDED");
    expect(await stockOf(h.pg, product.id)).toBe(7);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(30000n);
    console.log(`STATEMENTS amend: ${h.txLog.at(-1)?.queries}`);

    const audit = await h.pg.query(
      `SELECT metadata FROM audit_logs WHERE action = 'sale.create' AND "entityId" = $1`,
      [res.body.sale.id],
    );
    expect(JSON.stringify(audit.rows[0])).toContain(created.body.id);
  });

  it("atomic: a real failure in the second half leaves everything unchanged", async () => {
    const product = await seedProduct(h.pg, { stock: 10 });
    const accountA = await seedAccount(h.pg);
    const accountB = await seedAccount(h.pg);
    const created = await postSale(
      h.app,
      saleBody({ productId: product.id, quantity: 2, paidKobo: "20000", accountId: accountA.id, reference: `amd2-${newId("r")}` }),
    );
    expect(created.status).toBe(201);
    const before = await snapshot(h.pg, { productIds: [product.id], accountId: accountA.id, prefix: "amd2" });

    accountEntryCalls = 0;
    accountEntryHook = async (callNumber) => {
      if (callNumber === 2) {
        await h.pg.query(`UPDATE accounts SET "isActive" = false, "deactivatedAt" = now() WHERE id = $1`, [accountB.id]);
      }
    };
    let res;
    try {
      res = await call(
        "PUT",
        `/sales/${created.body.id}`,
        saleBody({ productId: product.id, quantity: 1, paidKobo: "10000", accountId: accountB.id }),
      );
    } finally {
      accountEntryHook = null;
    }
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await saleRow(created.body.id)).status).toBe("COMPLETED");
    expect(await stockOf(h.pg, product.id)).toBe(8);
    expect(await accountBalanceOf(h.pg, accountA.id)).toBe(20000n);
    expect(await accountBalanceOf(h.pg, accountB.id)).toBe(0n);
    expect(await snapshot(h.pg, { productIds: [product.id], accountId: accountA.id, prefix: "amd2" })).toEqual(before);
  });

  it("forbidden: amending a sale with an on-account payment is refused", async () => {
    const product = await seedProduct(h.pg, { stock: 10 });
    const customer = await seedCustomer(h.pg);
    const account = await seedAccount(h.pg);
    const sale = await creditSale({ customerId: customer.id, productId: product.id, prefix: "amd3" });
    await call("POST", `/sales/${sale.id}/payments`, { amountKobo: "1000", accountId: account.id, paidAt: paidAtNow() });
    const res = await call(
      "PUT",
      `/sales/${sale.id}`,
      saleBody({ productId: product.id, customerId: customer.id, quantity: 1 }),
    );
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/reverse the payments first/i);
    expect((await saleRow(sale.id)).status).toBe("COMPLETED");
  });
});

describe("GET /sales and GET /sales/:id", () => {
  it("detail includes lines, payments with account name and the customer", async () => {
    const product = await seedProduct(h.pg, { stock: 10 });
    const customer = await seedCustomer(h.pg);
    const account = await seedAccount(h.pg);
    const created = await postSale(
      h.app,
      saleBody({ productId: product.id, quantity: 2, customerId: customer.id, paidKobo: "5000", accountId: account.id, reference: `det-${newId("r")}` }),
    );
    const res = await call("GET", `/sales/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.balanceDueKobo).toBe("15000");
    expect(res.body.customer.name).toBe(customer.name);
    expect(res.body.lines[0].productName).toBe(product.name);
    expect(res.body.payments[0].accountName).toBe(account.name);
    expect(res.body.payments[0].reversed).toBe(false);

    const missing = await call("GET", `/sales/${newId("nope")}`);
    expect(missing.status).toBe(404);
  });

  it("filters and cursor pagination: no duplicates, no gaps", async () => {
    const product = await seedProduct(h.pg, { stock: 50 });
    const customer = await seedCustomer(h.pg);
    const account = await seedAccount(h.pg);
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await postSale(
        h.app,
        saleBody({
          productId: product.id,
          customerId: customer.id,
          paidKobo: i === 0 ? "10000" : "0",
          accountId: i === 0 ? account.id : null,
          soldAt: new Date(Date.now() - (i + 1) * 60_000 * 10).toISOString(),
        }),
      );
      expect(res.status).toBe(201);
      ids.push(res.body.id);
    }
    expect((await call("POST", `/sales/${ids[4]}/void`)).status).toBe(200);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `/sales?customerId=${customer.id}&limit=2${cursor ? `&cursor=${cursor}` : ""}`;
      const page = await call("GET", url);
      expect(page.status).toBe(200);
      seen.push(...page.body.items.map((item: any) => item.id));
      cursor = page.body.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 10);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(5);
    expect([...seen].sort()).toEqual([...ids].sort());

    const unpaid = await call("GET", `/sales?customerId=${customer.id}&unpaid=true`);
    expect(unpaid.body.items).toHaveLength(3);
    expect(unpaid.body.items.every((item: any) => item.balanceDueKobo === "10000")).toBe(true);

    const voided = await call("GET", `/sales?customerId=${customer.id}&status=VOIDED`);
    expect(voided.body.items.map((item: any) => item.id)).toEqual([ids[4]]);
    expect(voided.body.items[0].balanceDueKobo).toBe("0");

    const byName = await call("GET", `/sales?q=${encodeURIComponent(customer.name.toLowerCase())}`);
    expect(byName.body.items).toHaveLength(5);
    expect(byName.body.items[0].lineCount).toBe(1);

    const wholesale = await call("GET", `/sales?customerId=${customer.id}&channel=WHOLESALE`);
    expect(wholesale.body.items).toHaveLength(0);

    const day = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
    const ranged = await call("GET", `/sales?customerId=${customer.id}&from=${day}&to=${day}&limit=200`);
    expect(ranged.status).toBe(200);

    expect((await call("GET", `/sales?limit=500`)).status).toBe(400);
  });
});
