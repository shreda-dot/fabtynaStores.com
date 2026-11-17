import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolveSslConfig } from "../src/lib/ssl.js";
import { resolveTestConnectionString } from "./test-db.js";

let client: Client;
let ownerId: string;

async function createOwner(): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO empties_owners (id, name, "normalizedKey") VALUES ($1, $1, $1)`,
    [id],
  );
  return id;
}

async function createType(
  owner: string,
  kind: "BOTTLE" | "CRATE",
  capacity: number | null,
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO empties_types (id, "ownerId", kind, label, capacity)
     VALUES ($1, $2, $3, $1, $4)`,
    [id, owner, kind, capacity],
  );
  return id;
}

beforeAll(async () => {
  const connectionString = resolveTestConnectionString();
  client = new Client({ connectionString, ssl: resolveSslConfig(connectionString) });
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

beforeEach(async () => {
  await client.query("BEGIN");
  ownerId = await createOwner();
});

afterEach(async () => {
  await client.query("ROLLBACK");
});

describe("empties size-class schema", () => {
  it("allows legacy types, approved sizes, another brewery and ordinary type edits", async () => {
    await createType(ownerId, "BOTTLE", null);
    await createType(ownerId, "BOTTLE", null);
    await createType(ownerId, "CRATE", null);
    const typeId = await createType(ownerId, "BOTTLE", 12);
    await createType(ownerId, "BOTTLE", 20);
    await createType(ownerId, "BOTTLE", 24);
    await createType(await createOwner(), "BOTTLE", 12);
    await client.query(`UPDATE empties_types SET label = 'renamed', "isActive" = false WHERE id = $1`, [typeId]);
    const result = await client.query<{ label: string; isActive: boolean }>(
      `SELECT label, "isActive" FROM empties_types WHERE id = $1`,
      [typeId],
    );
    expect(result.rows[0]).toEqual({ label: "renamed", isActive: false });
  });

  it("rejects duplicate classes even when the first type is inactive", async () => {
    const typeId = await createType(ownerId, "BOTTLE", 12);
    await client.query(`UPDATE empties_types SET "isActive" = false WHERE id = $1`, [typeId]);
    await expect(createType(ownerId, "BOTTLE", 12)).rejects.toMatchObject({
      code: "23505",
      constraint: "ux_empties_types_owner_kind_capacity",
    });
  });

  it("rejects an unapproved size", async () => {
    await expect(createType(ownerId, "BOTTLE", 30)).rejects.toMatchObject({
      code: "23503",
      constraint: "fk_empties_types_capacity",
    });
  });

  it("rejects a sized crate type", async () => {
    await expect(createType(ownerId, "CRATE", 12)).rejects.toMatchObject({
      code: "23514",
      constraint: "ck_empties_types_capacity_bottle",
    });
  });

  it.each([
    { old: null, next: 12 },
    { old: 12, next: 20 },
    { old: 12, next: null },
  ])("rejects changing capacity from $old to $next", async ({ old, next }) => {
    const typeId = await createType(ownerId, "BOTTLE", old);
    await expect(
      client.query(`UPDATE empties_types SET capacity = $1 WHERE id = $2`, [next, typeId]),
    ).rejects.toThrow("empties_types.capacity is immutable once created.");
  });

  it("allows a new approved size and a matching type", async () => {
    await client.query(`INSERT INTO empties_approved_capacities (capacity) VALUES (30)`);
    const typeId = await createType(ownerId, "BOTTLE", 30);
    const result = await client.query<{ capacity: number }>(
      `SELECT capacity FROM empties_types WHERE id = $1`,
      [typeId],
    );
    expect(result.rows[0]?.capacity).toBe(30);
  });

  it("maintains and reverses bottle movements on a sized type without allowing a negative balance", async () => {
    const typeId = await createType(ownerId, "BOTTLE", 12);
    const actorId = randomUUID();
    const movementId = randomUUID();
    await client.query(
      `INSERT INTO admin_users (id, email, "passwordHash", "updatedAt")
       VALUES ($1, $2, 'not-a-real-hash', now())`,
      [actorId, `${actorId}@example.test`],
    );
    await client.query(
      `INSERT INTO empties_movements (id, "typeId", "movementType", quantity, note, "createdById")
       VALUES ($1, $2, 'ADJUSTMENT', 15, 'count', $3)`,
      [movementId, typeId, actorId],
    );
    const balance = await client.query<{ quantity: number }>(
      `SELECT quantity FROM empties_balances WHERE "typeId" = $1`,
      [typeId],
    );
    expect(balance.rows[0]?.quantity).toBe(15);
    await client.query(
      `INSERT INTO empties_movements
         (id, "typeId", "movementType", quantity, note, "createdById", "reversesEntryId")
       VALUES ($1, $2, 'ADJUSTMENT', -15, 'count', $3, $4)`,
      [randomUUID(), typeId, actorId, movementId],
    );
    const reversed = await client.query<{ quantity: number }>(
      `SELECT quantity FROM empties_balances WHERE "typeId" = $1`,
      [typeId],
    );
    expect(reversed.rows[0]?.quantity).toBe(0);
    await expect(
      client.query(
        `INSERT INTO empties_movements (id, "typeId", "movementType", quantity, note, "createdById")
         VALUES ($1, $2, 'ADJUSTMENT', -1, 'shortage', $3)`,
        [randomUUID(), typeId, actorId],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "ck_empties_balances_nonnegative" });
  });

  it("rejects invalid capacity configuration", async () => {
    await expect(
      client.query(`INSERT INTO empties_approved_capacities (capacity) VALUES (1)`),
    ).rejects.toMatchObject({ code: "23514", constraint: "ck_empties_approved_capacities_size" });
  });

  it.each([
    `UPDATE empties_approved_capacities SET capacity = 30 WHERE capacity = 12`,
    `DELETE FROM empties_approved_capacities WHERE capacity = 12`,
  ])("prevents rewriting or removing approved capacities: %s", async (sql) => {
    await expect(client.query(sql)).rejects.toThrow("empties_approved_capacities is immutable");
  });

  it("prevents truncating approved capacities", async () => {
    await expect(
      client.query(`TRUNCATE empties_approved_capacities CASCADE`),
    ).rejects.toThrow("empties_approved_capacities is immutable");
  });
});
