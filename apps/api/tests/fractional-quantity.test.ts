import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { resolveTestConnectionString } from "./test-db.js";

/**
 * Fractional pack quantities, proven against the database (migration
 * `20261017080000_fractional_line_quantities`).
 *
 * A wholesale customer may buy half a crate, so `sale_lines.quantity` and
 * `purchase_lines.quantity` are NUMERIC(12, 4). `quantityUnits` stays the
 * authoritative INTEGER base-unit count and `ck_*_lines_units_consistent`
 * requires the fraction to resolve to a whole number of units
 * (`quantityUnits = quantity * unitsPerPackSnapshot`), which ALTER COLUMN TYPE
 * re-validated for every existing row.
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
    const id = nextId("fq_admin");
    await c.query(
        `INSERT INTO admin_users (id, email, "passwordHash", "updatedAt")
     VALUES ($1, $2, $3, now())`,
        [id, `${id}@example.test`, "not-a-real-hash"],
    );
    return id;
}

async function seedCustomer(c: Client): Promise<string> {
    const id = nextId("fq_customer");
    await c.query(`INSERT INTO customers (id, name, "updatedAt") VALUES ($1, $2, now())`, [
        id,
        "Fraction Test Customer",
    ]);
    return id;
}

async function seedSupplier(c: Client): Promise<string> {
    const id = nextId("fq_supplier");
    await c.query(`INSERT INTO suppliers (id, name, "updatedAt") VALUES ($1, $2, now())`, [
        id,
        "Fraction Test Supplier",
    ]);
    return id;
}

async function seedProduct(c: Client, unitsPerPack: number): Promise<string> {
    const id = nextId("fq_product");
    await c.query(
        `INSERT INTO products
       (id, name, category, "unitsPerPack", "retailPriceKobo", "wholesalePriceKobo", "updatedAt")
     VALUES ($1, $2, 'BEER', $3, 150000::bigint, 140000::bigint, now())`,
        [id, "Fraction Test Beer", unitsPerPack],
    );
    return id;
}

async function insertSale(c: Client, adminId: string): Promise<string> {
    const id = nextId("fq_sale");
    await c.query(
        `INSERT INTO sales
       (id, "createdById", channel, status, "totalKobo", "paidKobo", "updatedAt")
     VALUES ($1, $2, 'RETAIL', 'COMPLETED', 150000::bigint, 150000::bigint, now())`,
        [id, adminId],
    );
    return id;
}

async function insertPurchase(c: Client, adminId: string, supplierId: string): Promise<string> {
    const id = nextId("fq_purchase");
    await c.query(
        `INSERT INTO purchases
       (id, "createdById", "supplierId", status, "totalKobo", "paidKobo", "updatedAt")
     VALUES ($1, $2, $3, 'RECEIVED', 150000::bigint, 150000::bigint, now())`,
        [id, adminId, supplierId],
    );
    return id;
}

async function insertSaleLine(
    c: Client,
    line: { saleId: string; productId: string; quantity: string; unitsPerPackSnapshot: number; quantityUnits: number },
): Promise<void> {
    await c.query(
        `INSERT INTO sale_lines
       (id, "saleId", "productId", location, unit, quantity, "unitsPerPackSnapshot", "quantityUnits",
        "unitPriceKobo", "costPerUnitKobo", "lineTotalKobo")
     VALUES ($1, $2, $3, 'WAREHOUSE', 'PACK', $4::numeric, $5, $6, 7500::bigint, 6250::bigint, 150000::bigint)`,
        [
            nextId("fq_sline"),
            line.saleId,
            line.productId,
            line.quantity,
            line.unitsPerPackSnapshot,
            line.quantityUnits,
        ],
    );
}

async function insertPurchaseLine(
    c: Client,
    line: { purchaseId: string; productId: string; quantity: string; unitsPerPackSnapshot: number; quantityUnits: number },
): Promise<void> {
    await c.query(
        `INSERT INTO purchase_lines
       (id, "purchaseId", "productId", unit, quantity, "unitsPerPackSnapshot", "quantityUnits",
        "unitCostKobo", "lineTotalKobo")
     VALUES ($1, $2, $3, 'PACK', $4::numeric, $5, $6, 6250::bigint, 150000::bigint)`,
        [
            nextId("fq_pline"),
            line.purchaseId,
            line.productId,
            line.quantity,
            line.unitsPerPackSnapshot,
            line.quantityUnits,
        ],
    );
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

describe("line quantity columns are NUMERIC(12, 4)", () => {
    it.each(["sale_lines", "purchase_lines"])("%s.quantity", async (table) => {
        const { rows } = await client.query(
            `select data_type, numeric_precision, numeric_scale
         from information_schema.columns
        where table_name = $1 and column_name = 'quantity'`,
            [table],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].data_type).toBe("numeric");
        expect(rows[0].numeric_precision).toBe(12);
        expect(rows[0].numeric_scale).toBe(4);
    });
});

describe("fractional sale lines", () => {
    it("ACCEPTS half a crate (0.5 PACK x 24 units = 12 units)", async () => {
        await inRollback(async (c) => {
            const adminId = await seedAdminUser(c);
            const productId = await seedProduct(c, 24);
            const saleId = await insertSale(c, adminId);
            await insertSaleLine(c, {
                saleId,
                productId,
                quantity: "0.5",
                unitsPerPackSnapshot: 24,
                quantityUnits: 12,
            });

            const { rows } = await c.query(
                `select quantity::text as q, "quantityUnits"::int as u from sale_lines where "saleId" = $1`,
                [saleId],
            );
            expect(rows[0].q).toBe("0.5000");
            expect(rows[0].u).toBe(12);
        });
    });

    it("ACCEPTS a tenth of a ten-unit pack (0.1 PACK x 10 units = 1 unit)", async () => {
        await inRollback(async (c) => {
            const adminId = await seedAdminUser(c);
            const productId = await seedProduct(c, 10);
            const saleId = await insertSale(c, adminId);
            await insertSaleLine(c, {
                saleId,
                productId,
                quantity: "0.1",
                unitsPerPackSnapshot: 10,
                quantityUnits: 1,
            });

            const { rows } = await c.query(
                `select "quantityUnits"::int as u from sale_lines where "saleId" = $1`,
                [saleId],
            );
            expect(rows[0].u).toBe(1);
        });
    });

    it("REJECTS a fraction that does not resolve to a whole number of units", async () => {
        await expect(
            inRollback(async (c) => {
                const adminId = await seedAdminUser(c);
                const productId = await seedProduct(c, 24);
                const saleId = await insertSale(c, adminId);
                // 0.3 x 24 = 7.2 units — not representable as an integer.
                await insertSaleLine(c, {
                    saleId,
                    productId,
                    quantity: "0.3",
                    unitsPerPackSnapshot: 24,
                    quantityUnits: 7,
                });
            }),
        ).rejects.toMatchObject({
            code: "23514",
            constraint: "ck_sale_lines_units_consistent",
        });
    });

    it("REJECTS a zero quantity", async () => {
        await expect(
            inRollback(async (c) => {
                const adminId = await seedAdminUser(c);
                const productId = await seedProduct(c, 24);
                const saleId = await insertSale(c, adminId);
                await insertSaleLine(c, {
                    saleId,
                    productId,
                    quantity: "0",
                    unitsPerPackSnapshot: 24,
                    quantityUnits: 0,
                });
            }),
        ).rejects.toMatchObject({
            code: "23514",
            constraint: "ck_sale_lines_quantity_positive",
        });
    });

    it("REJECTS a negative quantity", async () => {
        await expect(
            inRollback(async (c) => {
                const adminId = await seedAdminUser(c);
                const productId = await seedProduct(c, 24);
                const saleId = await insertSale(c, adminId);
                await insertSaleLine(c, {
                    saleId,
                    productId,
                    quantity: "-0.5",
                    unitsPerPackSnapshot: 24,
                    quantityUnits: -12,
                });
            }),
        ).rejects.toMatchObject({
            code: "23514",
            constraint: "ck_sale_lines_quantity_positive",
        });
    });
});

describe("fractional purchase lines", () => {
    it("ACCEPTS a quarter crate (0.25 PACK x 4 units = 1 unit)", async () => {
        await inRollback(async (c) => {
            const adminId = await seedAdminUser(c);
            const supplierId = await seedSupplier(c);
            const productId = await seedProduct(c, 4);
            const purchaseId = await insertPurchase(c, adminId, supplierId);
            await insertPurchaseLine(c, {
                purchaseId,
                productId,
                quantity: "0.25",
                unitsPerPackSnapshot: 4,
                quantityUnits: 1,
            });

            const { rows } = await c.query(
                `select "quantityUnits"::int as u from purchase_lines where "purchaseId" = $1`,
                [purchaseId],
            );
            expect(rows[0].u).toBe(1);
        });
    });
});
