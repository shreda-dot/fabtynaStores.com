import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { resolveTestConnectionString } from "./test-db.js";
import { runDbAudit } from "../src/db/audit.js";

/**
 * `stock_balances`: the database as the arbiter of "stock never goes below
 * zero" (migration `20261017100000_stock_balances`).
 *
 * The table is a derived, one-row-per-(product, location) cache of
 * `SUM(stock_movements.quantityUnits)`. It is maintained only by the AFTER
 * INSERT trigger `fn_apply_stock_movement`, which does a single
 * `INSERT ... ON CONFLICT DO UPDATE` — one statement that takes a row lock and
 * evaluates the arithmetic and `ck_stock_balances_nonnegative` under it, so two
 * concurrent sales cannot both read the same stale balance and both succeed.
 *
 * The deterministic tests roll every write back. The concurrency test cannot:
 * the race is only observable when the winner commits, so it deliberately
 * commits against a single reusable probe product and returns its balance to
 * zero at the end of every iteration.
 */

const connectionString = resolveTestConnectionString();
const clientOptions = { connectionString, ssl: { rejectUnauthorized: false } };

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

async function seedProduct(c: Client): Promise<string> {
    const id = nextId("sb_product");
    await c.query(
        `INSERT INTO products
       (id, name, category, "unitsPerPack", "retailPriceKobo", "wholesalePriceKobo", "updatedAt")
     VALUES ($1, $2, 'BEER', 24, 150000::bigint, 140000::bigint, now())`,
        [id, "Stock Balance Test Beer"],
    );
    return id;
}

/**
 * Exactly one source column must be set. `returnLineId` is a plain nullable
 * column with no foreign key (no return entity is modelled yet), which makes it
 * a usable synthetic source for a movement of any sign.
 */
async function insertMovement(
    c: Client,
    movement: {
        productId: string;
        type: string;
        quantityUnits: number;
        location?: string;
        returnLineId?: string;
    },
): Promise<string> {
    const id = nextId("sb_move");
    await c.query(
        `INSERT INTO stock_movements
       (id, "productId", location, type, "quantityUnits", "unitCostKobo", "returnLineId")
     VALUES ($1, $2, $3::"StockLocation", $4::"StockMovementType", $5, 0::bigint, $6)`,
        [
            id,
            movement.productId,
            movement.location ?? "WAREHOUSE",
            movement.type,
            movement.quantityUnits,
            movement.returnLineId ?? nextId("sb_return"),
        ],
    );
    return id;
}

async function balanceOf(c: Client, productId: string, location = "WAREHOUSE"): Promise<number> {
    const { rows } = await c.query(
        `select "quantityUnits"::int as n from stock_balances
      where "productId" = $1 and location = $2::"StockLocation"`,
        [productId, location],
    );
    return rows.length === 0 ? Number.NaN : rows[0].n;
}

beforeAll(async () => {
    client = new Client(clientOptions);
    await client.connect();
});

afterAll(async () => {
    if (client) {
        await client.end();
    }
});

describe("stock_balances shape", () => {
    it("is a table with ck_stock_balances_nonnegative and fk_stock_balances_product", async () => {
        const { rows: table } = await client.query(
            `select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind = 'r' and n.nspname = 'public' and c.relname = 'stock_balances'`,
        );
        expect(table).toHaveLength(1);

        const { rows: check } = await client.query(
            `select pg_get_constraintdef(oid) as def
         from pg_constraint
        where conrelid = 'stock_balances'::regclass
          and conname = 'ck_stock_balances_nonnegative'`,
        );
        expect(check).toHaveLength(1);
        expect(check[0].def as string).toContain('"quantityUnits" >= 0');

        const { rows: fk } = await client.query(
            `select 1 from pg_constraint where conname = 'fk_stock_balances_product'`,
        );
        expect(fk).toHaveLength(1);
    });

    it("has no row for a product that has never moved", async () => {
        await inRollback(async (c) => {
            const productId = await seedProduct(c);
            const { rows } = await c.query(
                `select count(*)::int as n from stock_balances where "productId" = $1`,
                [productId],
            );
            expect(rows[0].n).toBe(0);
        });
    });
});

describe("stock_balances follows stock_movements", () => {
    it("creates the balance from the first movement", async () => {
        await inRollback(async (c) => {
            const productId = await seedProduct(c);
            await insertMovement(c, { productId, type: "PURCHASE", quantityUnits: 24 });
            expect(await balanceOf(c, productId)).toBe(24);
        });
    });

    it("accumulates a signed running total", async () => {
        await inRollback(async (c) => {
            const productId = await seedProduct(c);
            await insertMovement(c, { productId, type: "PURCHASE", quantityUnits: 24 });
            await insertMovement(c, { productId, type: "ADJUSTMENT", quantityUnits: -10 });
            expect(await balanceOf(c, productId)).toBe(14);
        });
    });

    it("keeps one balance per location", async () => {
        await inRollback(async (c) => {
            const productId = await seedProduct(c);
            await insertMovement(c, {
                productId,
                type: "PURCHASE",
                quantityUnits: 24,
                location: "WAREHOUSE",
            });
            await insertMovement(c, {
                productId,
                type: "PURCHASE",
                quantityUnits: 5,
                location: "MARKET",
            });

            expect(await balanceOf(c, productId, "WAREHOUSE")).toBe(24);
            expect(await balanceOf(c, productId, "MARKET")).toBe(5);
        });
    });

    it("REJECTS a movement that would take the balance negative", async () => {
        await expect(
            inRollback(async (c) => {
                const productId = await seedProduct(c);
                await insertMovement(c, { productId, type: "ADJUSTMENT", quantityUnits: 10 });
                await insertMovement(c, { productId, type: "ADJUSTMENT", quantityUnits: -11 });
            }),
        ).rejects.toMatchObject({
            code: "23514",
            constraint: "ck_stock_balances_nonnegative",
        });
    });

    it("leaves the balance untouched when a movement is rejected", async () => {
        await inRollback(async (c) => {
            const productId = await seedProduct(c);
            await insertMovement(c, { productId, type: "ADJUSTMENT", quantityUnits: 10 });

            // A rejected statement aborts the whole transaction, so the balance
            // can only be read back after rolling back to a savepoint taken
            // before it.
            await c.query("SAVEPOINT before_rejected_movement");
            await expect(
                c.query(
                    `INSERT INTO stock_movements
             (id, "productId", location, type, "quantityUnits", "unitCostKobo", "returnLineId")
           VALUES ($1, $2, 'WAREHOUSE', 'ADJUSTMENT', -11, 0::bigint, $3)`,
                    [nextId("sb_move"), productId, nextId("sb_return")],
                ),
            ).rejects.toMatchObject({ code: "23514" });
            await c.query("ROLLBACK TO SAVEPOINT before_rejected_movement");

            expect(await balanceOf(c, productId)).toBe(10);
        });
    });
});

describe("stock_balances is not writable by hand", () => {
    it("REJECTS a direct INSERT", async () => {
        await expect(
            inRollback(async (c) => {
                const productId = await seedProduct(c);
                await c.query(
                    `INSERT INTO stock_balances ("productId", location, "quantityUnits")
           VALUES ($1, 'WAREHOUSE', 5)`,
                    [productId],
                );
            }),
        ).rejects.toMatchObject({ code: "P0001" });
    });

    it("REJECTS a direct UPDATE", async () => {
        await expect(
            inRollback(async (c) => {
                const productId = await seedProduct(c);
                await insertMovement(c, { productId, type: "PURCHASE", quantityUnits: 24 });
                await c.query(
                    `UPDATE stock_balances SET "quantityUnits" = 0
            WHERE "productId" = $1 and location = 'WAREHOUSE'`,
                    [productId],
                );
            }),
        ).rejects.toMatchObject({ code: "P0001" });
    });

    it("REJECTS a direct DELETE", async () => {
        await expect(
            inRollback(async (c) => {
                const productId = await seedProduct(c);
                await insertMovement(c, { productId, type: "PURCHASE", quantityUnits: 24 });
                await c.query(`DELETE FROM stock_balances WHERE "productId" = $1`, [productId]);
            }),
        ).rejects.toMatchObject({ code: "P0001" });
    });

    it("REJECTS TRUNCATE", async () => {
        await expect(
            inRollback(async (c) => {
                await c.query(`TRUNCATE stock_balances`);
            }),
        ).rejects.toMatchObject({ code: "P0001" });
    });
});

describe("concurrent movements cannot oversell (committed)", () => {
    const PROBE_PRODUCT_ID = "sb_concurrency_probe";
    const MAGNITUDE = 10;
    const ITERATIONS = 20;
    const INSERT_MOVEMENT = `INSERT INTO stock_movements
      (id, "productId", location, type, "quantityUnits", "unitCostKobo", "returnLineId")
    VALUES ($1, $2, 'WAREHOUSE', 'ADJUSTMENT', $3, 0::bigint, $4)`;

    beforeAll(async () => {
        await client.query(
            `INSERT INTO products
         (id, name, category, "unitsPerPack", "retailPriceKobo", "wholesalePriceKobo", "updatedAt")
       VALUES ($1, 'Stock Balance Probe', 'BEER', 24, 0::bigint, 0::bigint, now())
       ON CONFLICT (id) DO NOTHING`,
            [PROBE_PRODUCT_ID],
        );
    });

    afterAll(async () => {
        // Ensure the probe balance is zero (the test already does this, but verify it)
        const current = await balanceOf(client, PROBE_PRODUCT_ID);
        if (!Number.isNaN(current) && current !== 0) {
            // Normalise to zero if somehow not already
            const delta = -current;
            await client.query(INSERT_MOVEMENT, [
                nextId("sb_probe"),
                PROBE_PRODUCT_ID,
                delta,
                nextId("sb_return"),
            ]);
        }

        // Verify audit cleanliness - the probe product and its movements can stay
        // as long as the balance matches the movement sum (which is zero)
        const connectionString = resolveTestConnectionString();
        const result = await runDbAudit(connectionString);
        if (!result.ok) {
            const failed = result.checks.filter(
                (check) => check.error !== undefined || (check.severity === "fatal" && check.rowCount > 0),
            );
            const detail = failed
                .map((item) => `  - ${item.name}: ${item.rowCount} row${item.rowCount === 1 ? "" : "s"}`)
                .join("\n");
            throw new Error(
                `db:audit FAILED for ${result.databaseName} after concurrency test cleanup:\n${detail}`,
            );
        }
    });

    /** Moves the probe balance to exactly `MAGNITUDE` so each race starts even. */
    async function normalise(): Promise<void> {
        const current = await balanceOf(client, PROBE_PRODUCT_ID);
        const delta = MAGNITUDE - (Number.isNaN(current) ? 0 : current);
        if (delta === 0) return;
        await client.query(INSERT_MOVEMENT, [
            nextId("sb_probe"),
            PROBE_PRODUCT_ID,
            delta,
            nextId("sb_return"),
        ]);
    }

    async function attempt(
        session: Client,
    ): Promise<{ ok: boolean; code?: string; constraint?: string }> {
        try {
            await session.query(INSERT_MOVEMENT, [
                nextId("sb_probe"),
                PROBE_PRODUCT_ID,
                -MAGNITUDE,
                nextId("sb_return"),
            ]);
            await session.query("COMMIT");
            return { ok: true };
        } catch (error) {
            await session.query("ROLLBACK").catch(() => undefined);
            const err = error as { code?: string; constraint?: string };
            return { ok: false, code: err.code, constraint: err.constraint };
        }
    }

    it(`lets exactly one of two racing movements through, ${ITERATIONS} times`, async () => {
        const sessions = [new Client(clientOptions), new Client(clientOptions)];
        await Promise.all(sessions.map((s) => s.connect()));

        try {
            for (let i = 0; i < ITERATIONS; i++) {
                await normalise();

                // Both sessions are already inside a transaction, so the two inserts
                // are issued together and compete for the same balance row.
                await Promise.all(sessions.map((s) => s.query("BEGIN")));
                const results = await Promise.all(sessions.map((s) => attempt(s)));

                expect(results.filter((r) => r.ok)).toHaveLength(1);
                const loser = results.find((r) => !r.ok);
                expect(loser?.code).toBe("23514");
                expect(loser?.constraint).toBe("ck_stock_balances_nonnegative");

                expect(await balanceOf(client, PROBE_PRODUCT_ID)).toBe(0);
            }
        } finally {
            await Promise.all(sessions.map((s) => s.end().catch(() => undefined)));
        }
        // 20 races x several round trips to a remote database.
    }, 120_000);
});
