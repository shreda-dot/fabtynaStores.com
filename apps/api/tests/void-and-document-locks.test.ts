import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { resolveTestConnectionString } from "./test-db.js";

/**
 * Void guards and document locks, proven against the database:
 *   * `trg_sale_void_guard`            (20261017092000_sale_void_guard)
 *   * `trg_sale_document_lock` / `trg_purchase_document_lock`
 *   * the immutable line tables        (20261017110000_document_locks)
 *
 * `voidSale` reverses the stock movements and the customer ledger SALE entry
 * and nothing else, so voiding a sale that has an on-account PAYMENT ledger
 * entry would leave the customer balance wrong. The database refuses it. A
 * payment taken up front writes no ledger entry and stays voidable.
 *
 * Every write is rolled back (see `inRollback`). `tests/global-setup.ts` runs
 * `db:verify` first and aborts the run on schema drift.
 */

const connectionString = resolveTestConnectionString();

let client: Client;
let seq = 0;
const nextId = (prefix: string): string => `${prefix}_${Date.now()}_${seq++}`;

async function inRollback(body: (c: Client) => Promise<void>): Promise<void> {
    await client.query("BEGIN");
    try {
        await body(client);
    } finally {
        await client.query("ROLLBACK");
    }
}

async function seedAdminUser(c: Client): Promise<string> {
    const id = nextId("vd_admin");
    await c.query(
        `INSERT INTO admin_users (id, email, "passwordHash", "updatedAt")
     VALUES ($1, $2, $3, now())`,
        [id, `${id}@example.test`, "not-a-real-hash"],
    );
    return id;
}

async function seedCustomer(c: Client): Promise<string> {
    const id = nextId("vd_customer");
    await c.query(`INSERT INTO customers (id, name, "updatedAt") VALUES ($1, $2, now())`, [
        id,
        "Void Test Customer",
    ]);
    return id;
}

async function seedSupplier(c: Client): Promise<string> {
    const id = nextId("vd_supplier");
    await c.query(`INSERT INTO suppliers (id, name, "updatedAt") VALUES ($1, $2, now())`, [
        id,
        "Void Test Supplier",
    ]);
    return id;
}

async function seedProduct(c: Client): Promise<string> {
    const id = nextId("vd_product");
    await c.query(
        `INSERT INTO products
       (id, name, category, "unitsPerPack", "retailPriceKobo", "wholesalePriceKobo", "updatedAt")
     VALUES ($1, $2, 'BEER', 24, 150000::bigint, 140000::bigint, now())`,
        [id, "Void Test Beer"],
    );
    return id;
}

async function insertSale(
    c: Client,
    sale: { adminId: string; customerId: string | null; totalKobo: bigint; paidKobo: bigint },
): Promise<string> {
    const id = nextId("vd_sale");
    await c.query(
        `INSERT INTO sales
       (id, "createdById", "customerId", channel, status, "totalKobo", "paidKobo", "updatedAt")
     VALUES ($1, $2, $3, 'RETAIL', 'COMPLETED', $4::bigint, $5::bigint, now())`,
        [id, sale.adminId, sale.customerId, sale.totalKobo.toString(), sale.paidKobo.toString()],
    );
    return id;
}

async function insertSaleLine(
    c: Client,
    line: { saleId: string; productId: string },
): Promise<string> {
    const id = nextId("vd_sline");
    await c.query(
        `INSERT INTO sale_lines
       (id, "saleId", "productId", location, unit, quantity, "unitsPerPackSnapshot", "quantityUnits",
        "unitPriceKobo", "costPerUnitKobo", "lineTotalKobo")
     VALUES ($1, $2, $3, 'WAREHOUSE', 'PACK', 1, 24, 24, 7500::bigint, 6250::bigint, 150000::bigint)`,
        [id, line.saleId, line.productId],
    );
    return id;
}

async function insertSalePayment(
    c: Client,
    payment: { saleId: string; amountKobo: bigint },
): Promise<string> {
    const id = nextId("vd_spayment");
    await c.query(
        `INSERT INTO sale_payments (id, "saleId", "amountKobo", "paidAt")
     VALUES ($1, $2, $3::bigint, now())`,
        [id, payment.saleId, payment.amountKobo.toString()],
    );
    return id;
}

async function insertCustomerLedger(
    c: Client,
    entry: {
        customerId: string;
        type: string;
        amountKobo: bigint;
        saleId?: string | null;
        salePaymentId?: string | null;
    },
): Promise<string> {
    const id = nextId("vd_cledger");
    await c.query(
        `INSERT INTO customer_ledger_entries
       (id, "customerId", type, "amountKobo", "saleId", "salePaymentId")
     VALUES ($1, $2, $3::"CustomerLedgerEntryType", $4::bigint, $5, $6)`,
        [
            id,
            entry.customerId,
            entry.type,
            entry.amountKobo.toString(),
            entry.saleId ?? null,
            entry.salePaymentId ?? null,
        ],
    );
    return id;
}

async function insertPurchase(
    c: Client,
    purchase: { adminId: string; supplierId: string | null; totalKobo: bigint; paidKobo: bigint },
): Promise<string> {
    const id = nextId("vd_purchase");
    await c.query(
        `INSERT INTO purchases
       (id, "createdById", "supplierId", status, "totalKobo", "paidKobo", "updatedAt")
     VALUES ($1, $2, $3, 'RECEIVED', $4::bigint, $5::bigint, now())`,
        [
            id,
            purchase.adminId,
            purchase.supplierId,
            purchase.totalKobo.toString(),
            purchase.paidKobo.toString(),
        ],
    );
    return id;
}

async function insertPurchaseLine(
    c: Client,
    line: { purchaseId: string; productId: string },
): Promise<string> {
    const id = nextId("vd_pline");
    await c.query(
        `INSERT INTO purchase_lines
       (id, "purchaseId", "productId", unit, quantity, "unitsPerPackSnapshot", "quantityUnits",
        "unitCostKobo", "lineTotalKobo")
     VALUES ($1, $2, $3, 'PACK', 1, 24, 24, 6250::bigint, 150000::bigint)`,
        [id, line.purchaseId, line.productId],
    );
    return id;
}

beforeAll(async () => {
    client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    await client.connect();
});

afterAll(async () => {
    if (client) {
        await client.end();
    }
});

describe("trg_sale_void_guard", () => {
    it("is installed as a BEFORE UPDATE OF status trigger on sales", async () => {
        const { rows } = await client.query(
            `select p.proname
         from pg_trigger t
         join pg_proc p on p.oid = t.tgfoid
        where t.tgrelid = 'sales'::regclass
          and t.tgname = 'trg_sale_void_guard'`,
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].proname).toBe("fn_check_sale_void_guard");
    });

    it("REJECTS voiding a sale that has an on-account PAYMENT ledger entry", async () => {
        await expect(
            inRollback(async (c) => {
                const adminId = await seedAdminUser(c);
                const customerId = await seedCustomer(c);
                const saleId = await insertSale(c, {
                    adminId,
                    customerId,
                    totalKobo: 10000n,
                    paidKobo: 0n,
                });
                // The unpaid portion was written as a SALE ledger entry...
                await insertCustomerLedger(c, {
                    customerId,
                    type: "SALE",
                    amountKobo: 10000n,
                    saleId,
                });
                // ...and 4000 was later paid ON ACCOUNT, which writes a PAYMENT entry
                // pointing at the payment row (and deliberately NOT at the sale).
                const salePaymentId = await insertSalePayment(c, { saleId, amountKobo: 4000n });
                await insertCustomerLedger(c, {
                    customerId,
                    type: "PAYMENT",
                    amountKobo: -4000n,
                    saleId: null,
                    salePaymentId,
                });

                await c.query(`UPDATE sales SET status = 'VOIDED', "updatedAt" = now() WHERE id = $1`, [
                    saleId,
                ]);
            }),
        ).rejects.toMatchObject({ code: "P0001" });
    });

    it("ACCEPTS voiding a sale whose payment was taken up front (no PAYMENT ledger entry)", async () => {
        await inRollback(async (c) => {
            const adminId = await seedAdminUser(c);
            const customerId = await seedCustomer(c);
            const saleId = await insertSale(c, { adminId, customerId, totalKobo: 10000n, paidKobo: 4000n });
            await insertSalePayment(c, { saleId, amountKobo: 4000n });

            const result = await c.query(
                `UPDATE sales SET status = 'VOIDED', "updatedAt" = now() WHERE id = $1`,
                [saleId],
            );
            expect(result.rowCount).toBe(1);
        });
    });

    it("ACCEPTS voiding a sale with no payments at all", async () => {
        await inRollback(async (c) => {
            const adminId = await seedAdminUser(c);
            const saleId = await insertSale(c, {
                adminId,
                customerId: null,
                totalKobo: 1000n,
                paidKobo: 1000n,
            });

            const result = await c.query(
                `UPDATE sales SET status = 'VOIDED', "updatedAt" = now() WHERE id = $1`,
                [saleId],
            );
            expect(result.rowCount).toBe(1);
        });
    });
});

describe("trg_sale_document_lock / trg_purchase_document_lock", () => {
    it("REJECTS editing a column outside the allowlist on a completed sale", async () => {
        await expect(
            inRollback(async (c) => {
                const adminId = await seedAdminUser(c);
                const saleId = await insertSale(c, {
                    adminId,
                    customerId: null,
                    totalKobo: 1000n,
                    paidKobo: 1000n,
                });
                await c.query(`UPDATE sales SET notes = 'edited' WHERE id = $1`, [saleId]);
            }),
        ).rejects.toMatchObject({ code: "P0001" });
    });

    it("ALLOWS paidKobo, status and updatedAt to change on a completed sale", async () => {
        await inRollback(async (c) => {
            const adminId = await seedAdminUser(c);
            const customerId = await seedCustomer(c);
            const saleId = await insertSale(c, { adminId, customerId, totalKobo: 10000n, paidKobo: 0n });

            const result = await c.query(
                `UPDATE sales SET "paidKobo" = 5000::bigint, "updatedAt" = now() WHERE id = $1`,
                [saleId],
            );
            expect(result.rowCount).toBe(1);
        });
    });

    it("REJECTS deleting a sale that is not a draft", async () => {
        await expect(
            inRollback(async (c) => {
                const adminId = await seedAdminUser(c);
                const saleId = await insertSale(c, {
                    adminId,
                    customerId: null,
                    totalKobo: 1000n,
                    paidKobo: 1000n,
                });
                await c.query(`DELETE FROM sales WHERE id = $1`, [saleId]);
            }),
        ).rejects.toMatchObject({ code: "P0001" });
    });

    it("REJECTS editing a received purchase", async () => {
        await expect(
            inRollback(async (c) => {
                const adminId = await seedAdminUser(c);
                const supplierId = await seedSupplier(c);
                const purchaseId = await insertPurchase(c, {
                    adminId,
                    supplierId,
                    totalKobo: 1000n,
                    paidKobo: 1000n,
                });
                await c.query(`UPDATE purchases SET notes = 'edited' WHERE id = $1`, [purchaseId]);
            }),
        ).rejects.toMatchObject({ code: "P0001" });
    });

    it("REJECTS deleting a received purchase", async () => {
        await expect(
            inRollback(async (c) => {
                const adminId = await seedAdminUser(c);
                const supplierId = await seedSupplier(c);
                const purchaseId = await insertPurchase(c, {
                    adminId,
                    supplierId,
                    totalKobo: 1000n,
                    paidKobo: 1000n,
                });
                await c.query(`DELETE FROM purchases WHERE id = $1`, [purchaseId]);
            }),
        ).rejects.toMatchObject({ code: "P0001" });
    });
});

describe("line tables are immutable", () => {
    it("REJECTS updating a sale line", async () => {
        await expect(
            inRollback(async (c) => {
                const adminId = await seedAdminUser(c);
                const productId = await seedProduct(c);
                const saleId = await insertSale(c, {
                    adminId,
                    customerId: null,
                    totalKobo: 150000n,
                    paidKobo: 150000n,
                });
                const lineId = await insertSaleLine(c, { saleId, productId });
                await c.query(`UPDATE sale_lines SET "quantityUnits" = 12 WHERE id = $1`, [lineId]);
            }),
        ).rejects.toMatchObject({ code: "P0001" });
    });

    it("REJECTS deleting a sale line", async () => {
        await expect(
            inRollback(async (c) => {
                const adminId = await seedAdminUser(c);
                const productId = await seedProduct(c);
                const saleId = await insertSale(c, {
                    adminId,
                    customerId: null,
                    totalKobo: 150000n,
                    paidKobo: 150000n,
                });
                const lineId = await insertSaleLine(c, { saleId, productId });
                await c.query(`DELETE FROM sale_lines WHERE id = $1`, [lineId]);
            }),
        ).rejects.toMatchObject({ code: "P0001" });
    });

    it("REJECTS updating a purchase line", async () => {
        await expect(
            inRollback(async (c) => {
                const adminId = await seedAdminUser(c);
                const supplierId = await seedSupplier(c);
                const productId = await seedProduct(c);
                const purchaseId = await insertPurchase(c, {
                    adminId,
                    supplierId,
                    totalKobo: 150000n,
                    paidKobo: 150000n,
                });
                const lineId = await insertPurchaseLine(c, { purchaseId, productId });
                await c.query(`UPDATE purchase_lines SET "quantityUnits" = 12 WHERE id = $1`, [lineId]);
            }),
        ).rejects.toMatchObject({ code: "P0001" });
    });
});
