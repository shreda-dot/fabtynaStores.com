import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { resolveTestConnectionString } from "./test-db.js";

/**
 * Reversal rows, proven against the database (migration
 * `20261017070000_reversal_sign_exemption`).
 *
 * A reversal copies its target and negates ONLY the magnitude column
 * (`amountKobo` for ledgers, `quantityUnits` for stock movements), keeping the
 * target's `type` and every source column. The sign CHECKs used to reject every
 * legal reversal, so they were rebuilt with a
 * `"reversesEntryId" IS NOT NULL OR (...)` exemption — paired with
 * `fn_check_reversal_integrity`, which proves the negation is exact.
 *
 * These tests therefore come in pairs: the same row is accepted WITH
 * `reversesEntryId` and rejected WITHOUT it; and a reversal that does not
 * negate its target exactly (wrong magnitude, wrong type, wrong source column)
 * is rejected.
 *
 * Every write is rolled back (see `inRollback`), so the test database is left
 * untouched and the dev database is never reached. `tests/global-setup.ts` runs
 * `db:verify` first and aborts the run on schema drift.
 */

const connectionString = resolveTestConnectionString();

let client: Client;
let seq = 0;
const nextId = (prefix: string): string => `${prefix}_${Date.now()}_${seq++}`;

/** Runs `body` inside a transaction that is always rolled back. */
async function inRollback(body: (c: Client) => Promise<void>): Promise<void> {
    await client.query("BEGIN");
    try {
        await body(client);
    } finally {
        await client.query("ROLLBACK");
    }
}

async function seedAdminUser(c: Client): Promise<string> {
    const id = nextId("rv_admin");
    await c.query(
        `INSERT INTO admin_users (id, email, "passwordHash", "updatedAt")
     VALUES ($1, $2, $3, now())`,
        [id, `${id}@example.test`, "not-a-real-hash"],
    );
    return id;
}

async function seedCustomer(c: Client): Promise<string> {
    const id = nextId("rv_customer");
    await c.query(`INSERT INTO customers (id, name, "updatedAt") VALUES ($1, $2, now())`, [
        id,
        "Reversal Test Customer",
    ]);
    return id;
}

async function seedSupplier(c: Client): Promise<string> {
    const id = nextId("rv_supplier");
    await c.query(`INSERT INTO suppliers (id, name, "updatedAt") VALUES ($1, $2, now())`, [
        id,
        "Reversal Test Supplier",
    ]);
    return id;
}

async function seedLoan(c: Client): Promise<string> {
    const id = nextId("rv_loan");
    await c.query(
        `INSERT INTO loans (id, "lenderName", "principalKobo", "agreedInterestKobo", "disbursedAt")
     VALUES ($1, $2, $3::bigint, $4::bigint, now())`,
        [id, "Reversal Test Lender", "100000", "10000"],
    );
    return id;
}

async function seedProduct(c: Client): Promise<string> {
    const id = nextId("rv_product");
    await c.query(
        `INSERT INTO products
       (id, name, category, "unitsPerPack", "retailPriceKobo", "wholesalePriceKobo", "updatedAt")
     VALUES ($1, $2, 'BEER', 24, 150000::bigint, 140000::bigint, now())`,
        [id, "Reversal Test Beer"],
    );
    return id;
}

async function insertSale(
    c: Client,
    sale: {
        adminId: string;
        customerId: string | null;
        totalKobo: bigint;
        paidKobo: bigint;
    },
): Promise<string> {
    const id = nextId("rv_sale");
    await c.query(
        `INSERT INTO sales
       (id, "createdById", "customerId", channel, status, "totalKobo", "paidKobo", "updatedAt")
     VALUES ($1, $2, $3, 'RETAIL', 'COMPLETED', $4::bigint, $5::bigint, now())`,
        [id, sale.adminId, sale.customerId, sale.totalKobo.toString(), sale.paidKobo.toString()],
    );
    return id;
}

async function insertPurchase(
    c: Client,
    purchase: { adminId: string; supplierId: string | null; totalKobo: bigint; paidKobo: bigint },
): Promise<string> {
    const id = nextId("rv_purchase");
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

async function seedPurchaseLine(
    c: Client,
    line: { purchaseId: string; productId: string },
): Promise<string> {
    const id = nextId("rv_pline");
    await c.query(
        `INSERT INTO purchase_lines
       (id, "purchaseId", "productId", unit, quantity, "unitsPerPackSnapshot", "quantityUnits",
        "unitCostKobo", "lineTotalKobo")
     VALUES ($1, $2, $3, 'PACK', 1, 24, 24, 6250::bigint, 150000::bigint)`,
        [id, line.purchaseId, line.productId],
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
        reversesEntryId?: string | null;
    },
): Promise<string> {
    const id = nextId("rv_cledger");
    await c.query(
        `INSERT INTO customer_ledger_entries
       (id, "customerId", type, "amountKobo", "saleId", "reversesEntryId")
     VALUES ($1, $2, $3::"CustomerLedgerEntryType", $4::bigint, $5, $6)`,
        [
            id,
            entry.customerId,
            entry.type,
            entry.amountKobo.toString(),
            entry.saleId ?? null,
            entry.reversesEntryId ?? null,
        ],
    );
    return id;
}

async function insertSupplierLedger(
    c: Client,
    entry: {
        supplierId: string;
        type: string;
        amountKobo: bigint;
        purchaseId?: string | null;
        reversesEntryId?: string | null;
    },
): Promise<string> {
    const id = nextId("rv_sledger");
    await c.query(
        `INSERT INTO supplier_ledger_entries
       (id, "supplierId", type, "amountKobo", "purchaseId", "reversesEntryId")
     VALUES ($1, $2, $3::"SupplierLedgerEntryType", $4::bigint, $5, $6)`,
        [
            id,
            entry.supplierId,
            entry.type,
            entry.amountKobo.toString(),
            entry.purchaseId ?? null,
            entry.reversesEntryId ?? null,
        ],
    );
    return id;
}

async function insertLoanLedger(
    c: Client,
    entry: { loanId: string; type: string; amountKobo: bigint; reversesEntryId?: string | null },
): Promise<string> {
    const id = nextId("rv_lledger");
    await c.query(
        `INSERT INTO loan_ledger_entries
       (id, "loanId", type, "amountKobo", "reversesEntryId")
     VALUES ($1, $2, $3::"LoanLedgerEntryType", $4::bigint, $5)`,
        [id, entry.loanId, entry.type, entry.amountKobo.toString(), entry.reversesEntryId ?? null],
    );
    return id;
}

/**
 * Exactly one source column must be set. `returnLineId` is a plain nullable
 * column with no foreign key (the return entity is not modelled yet), so it is
 * also usable as a synthetic source when no real line is needed.
 */
async function insertMovement(
    c: Client,
    movement: {
        productId: string;
        type: string;
        quantityUnits: number;
        location?: string;
        purchaseLineId?: string;
        returnLineId?: string;
        reversesEntryId?: string | null;
        unitCostKobo?: bigint;
    },
): Promise<string> {
    const id = nextId("rv_move");
    await c.query(
        `INSERT INTO stock_movements
       (id, "productId", location, type, "quantityUnits", "unitCostKobo",
        "purchaseLineId", "returnLineId", "reversesEntryId")
     VALUES ($1, $2, $3::"StockLocation", $4::"StockMovementType", $5, $6::bigint, $7, $8, $9)`,
        [
            id,
            movement.productId,
            movement.location ?? "WAREHOUSE",
            movement.type,
            movement.quantityUnits,
            (movement.unitCostKobo ?? 0n).toString(),
            movement.purchaseLineId ?? null,
            movement.returnLineId ?? null,
            movement.reversesEntryId ?? null,
        ],
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

describe("sign CHECKs exempt reversal rows", () => {
    it("ck_customer_ledger_amount_sign is `reversesEntryId IS NOT NULL OR (...)`", async () => {
        const { rows } = await client.query(
            `select pg_get_constraintdef(oid) as def
         from pg_constraint
        where conrelid = 'customer_ledger_entries'::regclass
          and conname = 'ck_customer_ledger_amount_sign'`,
        );
        expect(rows).toHaveLength(1);
        const def = rows[0].def as string;
        expect(def).toContain('"reversesEntryId" IS NOT NULL');
        expect(def).toContain("'SALE'");
    });

    it("ck_stock_movement_quantity_sign is `reversesEntryId IS NOT NULL OR (...)`", async () => {
        const { rows } = await client.query(
            `select pg_get_constraintdef(oid) as def
         from pg_constraint
        where conrelid = 'stock_movements'::regclass
          and conname = 'ck_stock_movement_quantity_sign'`,
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].def as string).toContain('"reversesEntryId" IS NOT NULL');
    });
});

describe("customer ledger reversals", () => {
    it("ACCEPTS a reversal of a SALE entry (negative SALE, same customer and sale)", async () => {
        await inRollback(async (c) => {
            const adminId = await seedAdminUser(c);
            const customerId = await seedCustomer(c);
            const saleId = await insertSale(c, { adminId, customerId, totalKobo: 1000n, paidKobo: 0n });

            const target = await insertCustomerLedger(c, {
                customerId,
                type: "SALE",
                amountKobo: 1000n,
                saleId,
            });
            await insertCustomerLedger(c, {
                customerId,
                type: "SALE",
                amountKobo: -1000n,
                saleId,
                reversesEntryId: target,
            });

            const { rows } = await c.query(
                `select count(*)::int as n from customer_ledger_entries where "reversesEntryId" = $1`,
                [target],
            );
            expect(rows[0].n).toBe(1);
        });
    });

    it("REJECTS the same negative SALE row when it does NOT declare a reversal", async () => {
        await expect(
            inRollback(async (c) => {
                const customerId = await seedCustomer(c);
                await insertCustomerLedger(c, { customerId, type: "SALE", amountKobo: -1000n });
            }),
        ).rejects.toMatchObject({
            code: "23514",
            constraint: "ck_customer_ledger_amount_sign",
        });
    });

    it("REJECTS a reversal whose magnitude is not the exact negation", async () => {
        await expect(
            inRollback(async (c) => {
                const customerId = await seedCustomer(c);
                const target = await insertCustomerLedger(c, {
                    customerId,
                    type: "SALE",
                    amountKobo: 1000n,
                });
                await insertCustomerLedger(c, {
                    customerId,
                    type: "SALE",
                    amountKobo: -999n,
                    reversesEntryId: target,
                });
            }),
        ).rejects.toMatchObject({ code: "P0001" });
    });

    it("REJECTS a reversal whose type does not match its target", async () => {
        await expect(
            inRollback(async (c) => {
                const customerId = await seedCustomer(c);
                const target = await insertCustomerLedger(c, {
                    customerId,
                    type: "SALE",
                    amountKobo: 1000n,
                });
                await insertCustomerLedger(c, {
                    customerId,
                    type: "PAYMENT",
                    amountKobo: -1000n,
                    reversesEntryId: target,
                });
            }),
        ).rejects.toMatchObject({ code: "P0001" });
    });

    it("REJECTS a reversal whose source column does not match its target", async () => {
        await expect(
            inRollback(async (c) => {
                const adminId = await seedAdminUser(c);
                const customerId = await seedCustomer(c);
                const saleId = await insertSale(c, { adminId, customerId, totalKobo: 1000n, paidKobo: 0n });
                const target = await insertCustomerLedger(c, {
                    customerId,
                    type: "SALE",
                    amountKobo: 1000n,
                    saleId,
                });
                // Same magnitude and type, but the reversal drops the saleId.
                await insertCustomerLedger(c, {
                    customerId,
                    type: "SALE",
                    amountKobo: -1000n,
                    saleId: null,
                    reversesEntryId: target,
                });
            }),
        ).rejects.toMatchObject({ code: "P0001" });
    });

    it("REJECTS a second reversal of the same row (ux_customer_ledger_reversed_once)", async () => {
        await expect(
            inRollback(async (c) => {
                const customerId = await seedCustomer(c);
                const target = await insertCustomerLedger(c, {
                    customerId,
                    type: "SALE",
                    amountKobo: 1000n,
                });
                await insertCustomerLedger(c, {
                    customerId,
                    type: "SALE",
                    amountKobo: -1000n,
                    reversesEntryId: target,
                });
                await insertCustomerLedger(c, {
                    customerId,
                    type: "SALE",
                    amountKobo: -1000n,
                    reversesEntryId: target,
                });
            }),
        ).rejects.toMatchObject({
            code: "23505",
            constraint: "ux_customer_ledger_reversed_once",
        });
    });

    it("REJECTS a reversal whose target does not exist", async () => {
        await expect(
            inRollback(async (c) => {
                const customerId = await seedCustomer(c);
                await insertCustomerLedger(c, {
                    customerId,
                    type: "SALE",
                    amountKobo: -1000n,
                    reversesEntryId: nextId("rv_ghost"),
                });
            }),
        ).rejects.toMatchObject({ code: "P0001" });
    });
});

describe("supplier ledger reversals", () => {
    it("ACCEPTS a reversal of a PURCHASE entry", async () => {
        await inRollback(async (c) => {
            const adminId = await seedAdminUser(c);
            const supplierId = await seedSupplier(c);
            const purchaseId = await insertPurchase(c, {
                adminId,
                supplierId,
                totalKobo: 5000n,
                paidKobo: 5000n,
            });

            const target = await insertSupplierLedger(c, {
                supplierId,
                type: "PURCHASE",
                amountKobo: 5000n,
                purchaseId,
            });
            await insertSupplierLedger(c, {
                supplierId,
                type: "PURCHASE",
                amountKobo: -5000n,
                purchaseId,
                reversesEntryId: target,
            });

            const { rows } = await c.query(
                `select count(*)::int as n from supplier_ledger_entries where "reversesEntryId" = $1`,
                [target],
            );
            expect(rows[0].n).toBe(1);
        });
    });

    it("REJECTS a negative PURCHASE entry that is not a reversal", async () => {
        await expect(
            inRollback(async (c) => {
                const supplierId = await seedSupplier(c);
                await insertSupplierLedger(c, {
                    supplierId,
                    type: "PURCHASE",
                    amountKobo: -5000n,
                });
            }),
        ).rejects.toMatchObject({
            code: "23514",
            constraint: "ck_supplier_ledger_amount_sign",
        });
    });
});

describe("loan ledger reversals", () => {
    it("ACCEPTS a reversal of a DISBURSEMENT entry", async () => {
        await inRollback(async (c) => {
            const loanId = await seedLoan(c);
            const target = await insertLoanLedger(c, {
                loanId,
                type: "DISBURSEMENT",
                amountKobo: 100000n,
            });
            await insertLoanLedger(c, {
                loanId,
                type: "DISBURSEMENT",
                amountKobo: -100000n,
                reversesEntryId: target,
            });

            const { rows } = await c.query(
                `select count(*)::int as n from loan_ledger_entries where "reversesEntryId" = $1`,
                [target],
            );
            expect(rows[0].n).toBe(1);
        });
    });

    it("REJECTS a negative DISBURSEMENT entry that is not a reversal", async () => {
        await expect(
            inRollback(async (c) => {
                const loanId = await seedLoan(c);
                await insertLoanLedger(c, {
                    loanId,
                    type: "DISBURSEMENT",
                    amountKobo: -100000n,
                });
            }),
        ).rejects.toMatchObject({
            code: "23514",
            constraint: "ck_loan_ledger_amount_sign",
        });
    });
});

describe("stock movement reversals", () => {
    it("ACCEPTS a reversal of a PURCHASE movement (negative PURCHASE, same line)", async () => {
        await inRollback(async (c) => {
            const adminId = await seedAdminUser(c);
            const supplierId = await seedSupplier(c);
            const productId = await seedProduct(c);
            const purchaseId = await insertPurchase(c, {
                adminId,
                supplierId,
                totalKobo: 150000n,
                paidKobo: 150000n,
            });
            const purchaseLineId = await seedPurchaseLine(c, { purchaseId, productId });

            const target = await insertMovement(c, {
                productId,
                type: "PURCHASE",
                quantityUnits: 24,
                purchaseLineId,
                unitCostKobo: 6250n,
            });
            await insertMovement(c, {
                productId,
                type: "PURCHASE",
                quantityUnits: -24,
                purchaseLineId,
                unitCostKobo: 6250n,
                reversesEntryId: target,
            });

            const { rows } = await c.query(
                `select count(*)::int as n from stock_movements where "reversesEntryId" = $1`,
                [target],
            );
            expect(rows[0].n).toBe(1);

            // +24 then -24 nets to zero, which is what the derived balance proves.
            const { rows: balance } = await c.query(
                `select "quantityUnits"::int as n from stock_balances
          where "productId" = $1 and location = 'WAREHOUSE'`,
                [productId],
            );
            expect(balance[0].n).toBe(0);
        });
    });

    it("REJECTS a negative PURCHASE movement that is not a reversal", async () => {
        await expect(
            inRollback(async (c) => {
                const productId = await seedProduct(c);
                await insertMovement(c, {
                    productId,
                    type: "PURCHASE",
                    quantityUnits: -24,
                    returnLineId: nextId("rv_return"),
                });
            }),
        ).rejects.toMatchObject({
            code: "23514",
            constraint: "ck_stock_movement_quantity_sign",
        });
    });

    it("REJECTS a reversal whose magnitude is not the exact negation", async () => {
        await expect(
            inRollback(async (c) => {
                const productId = await seedProduct(c);
                const returnLineId = nextId("rv_return");
                const target = await insertMovement(c, {
                    productId,
                    type: "PURCHASE",
                    quantityUnits: 24,
                    returnLineId,
                });
                await insertMovement(c, {
                    productId,
                    type: "PURCHASE",
                    quantityUnits: -23,
                    returnLineId,
                    reversesEntryId: target,
                });
            }),
        ).rejects.toMatchObject({ code: "P0001" });
    });

    it("REJECTS a reversal that moves a different location (source column mismatch)", async () => {
        await expect(
            inRollback(async (c) => {
                const productId = await seedProduct(c);
                const returnLineId = nextId("rv_return");
                const target = await insertMovement(c, {
                    productId,
                    type: "PURCHASE",
                    quantityUnits: 24,
                    location: "WAREHOUSE",
                    returnLineId,
                });
                await insertMovement(c, {
                    productId,
                    type: "PURCHASE",
                    quantityUnits: -24,
                    location: "MARKET",
                    returnLineId,
                    reversesEntryId: target,
                });
            }),
        ).rejects.toMatchObject({ code: "P0001" });
    });

    it("REJECTS reversing a reversal", async () => {
        await expect(
            inRollback(async (c) => {
                const productId = await seedProduct(c);
                const returnLineId = nextId("rv_return");
                const target = await insertMovement(c, {
                    productId,
                    type: "PURCHASE",
                    quantityUnits: 24,
                    returnLineId,
                });
                const reversal = await insertMovement(c, {
                    productId,
                    type: "PURCHASE",
                    quantityUnits: -24,
                    returnLineId,
                    reversesEntryId: target,
                });
                await insertMovement(c, {
                    productId,
                    type: "PURCHASE",
                    quantityUnits: 24,
                    returnLineId,
                    reversesEntryId: reversal,
                });
            }),
        ).rejects.toMatchObject({ code: "P0001" });
    });
});
