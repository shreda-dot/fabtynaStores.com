import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  EXPECTED_CHECK_CONSTRAINTS,
  EXPECTED_FOREIGN_KEYS,
  EXPECTED_MIGRATIONS,
  EXPECTED_PARTIAL_INDEXES,
  EXPECTED_TABLES,
  EXPECTED_TRIGGERS,
} from "./expected-schema.js";

/**
 * The database-side half of `db:verify`.
 *
 * It answers three questions and nothing else — it is strictly read-only:
 *   1. Has every migration on disk been applied, finished, and left untouched?
 *   2. Does every table, CHECK constraint, trigger and partial index we expect
 *      exist?
 *   3. Are there none we did not expect of those same four kinds?
 *
 * It never prints or returns the connection string; callers only ever see the
 * database name and host.
 */

const MIGRATIONS_DIR = fileURLToPath(new URL("../../prisma/migrations", import.meta.url));

export type VerifyKind =
  | "migration"
  | "checksum"
  | "table"
  | "check constraint"
  | "trigger"
  | "partial index"
  | "foreign key";

export interface VerifyItem {
  kind: VerifyKind;
  name: string;
  ok: boolean;
  /** Extra context, e.g. why a migration is bad or an unexpected object. */
  detail?: string;
}

export interface MigrationHistoryEntry {
  name: string;
  finished: boolean;
  rolledBack: boolean;
}

export interface VerifyResult {
  ok: boolean;
  /** Database name only (never the connection string). */
  databaseName: string;
  host: string;
  items: VerifyItem[];
  /** Raw `_prisma_migrations` state, for the printed audit trail. */
  migrationHistory: MigrationHistoryEntry[];
  found: {
    migrations: string[];
    tables: string[];
    checkConstraints: string[];
    triggers: string[];
    partialIndexes: string[];
    foreignKeys: string[];
  };
  failures: VerifyItem[];
}

interface MigrationRow {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
  logs: string | null;
  checksum: string;
}

/** Reads just the database name out of a connection string. */
export function databaseNameOf(connectionString: string): string {
  return new URL(connectionString).pathname.replace(/^\//, "");
}

/** Reads just the host out of a connection string. */
export function hostOf(connectionString: string): string {
  return new URL(connectionString).host;
}

/** sha256 of a migration file — the value Prisma records in `checksum`. */
async function checksumOfMigration(migrationName: string): Promise<string> {
  const contents = await readFile(join(MIGRATIONS_DIR, migrationName, "migration.sql"));
  return createHash("sha256").update(contents).digest("hex");
}

function missing(expected: readonly string[], found: readonly string[]): string[] {
  const foundSet = new Set(found);
  return expected.filter((name) => !foundSet.has(name));
}

export async function runDbVerify(connectionString: string): Promise<VerifyResult> {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const migrationRows = await client.query<MigrationRow>(
      `SELECT migration_name, finished_at, rolled_back_at, logs, checksum
         FROM _prisma_migrations
        ORDER BY started_at`,
    );

    const checkRows = await client.query<{ conname: string }>(
      `SELECT conname
         FROM pg_constraint
        WHERE contype = 'c'
          AND connamespace = 'public'::regnamespace
        ORDER BY conname`,
    );

    const triggerRows = await client.query<{ tgname: string }>(
      `SELECT t.tgname
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE NOT t.tgisinternal
          AND n.nspname = 'public'
        ORDER BY t.tgname`,
    );

    const indexRows = await client.query<{ indexname: string }>(
      `SELECT ic.relname AS indexname
         FROM pg_index i
         JOIN pg_class ic ON ic.oid = i.indexrelid
         JOIN pg_namespace n ON n.oid = ic.relnamespace
        WHERE i.indpred IS NOT NULL
          AND n.nspname = 'public'
        ORDER BY ic.relname`,
    );

    const foreignKeyRows = await client.query<{ conname: string }>(
      `SELECT conname
         FROM pg_constraint
        WHERE contype = 'f'
          AND connamespace = 'public'::regnamespace
        ORDER BY conname`,
    );

    const tableRows = await client.query<{ relname: string }>(
      `SELECT c.relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r'
          AND n.nspname = 'public'
        ORDER BY c.relname`,
    );

    const appliedMigrations = migrationRows.rows.map((row) => row.migration_name);
    const foundCheckConstraints = checkRows.rows.map((row) => row.conname);
    const foundTriggers = triggerRows.rows.map((row) => row.tgname);
    const foundPartialIndexes = indexRows.rows.map((row) => row.indexname);
    const foundForeignKeys = foreignKeyRows.rows.map((row) => row.conname);
    const foundTables = tableRows.rows.map((row) => row.relname);

    const items: VerifyItem[] = [];

    // ---------- migrations: applied, finished, not rolled back, not failed ----
    for (const row of migrationRows.rows) {
      if (row.finished_at === null) {
        items.push({ kind: "migration", name: row.migration_name, ok: false, detail: "never finished" });
      } else if (row.rolled_back_at !== null) {
        items.push({ kind: "migration", name: row.migration_name, ok: false, detail: "rolled back" });
      } else if (row.logs !== null && row.logs.trim() !== "") {
        items.push({ kind: "migration", name: row.migration_name, ok: false, detail: `logged an error: ${row.logs.trim()}` });
      } else {
        items.push({ kind: "migration", name: row.migration_name, ok: true });
      }
    }

    for (const name of missing(EXPECTED_MIGRATIONS, appliedMigrations)) {
      items.push({ kind: "migration", name, ok: false, detail: "on disk but not applied to this database" });
    }

    // ---------- migration files match what was applied (checksum) ----------
    const migrationsOnDisk = (await readdir(MIGRATIONS_DIR, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    for (const name of missing(migrationsOnDisk, appliedMigrations)) {
      items.push({ kind: "checksum", name, ok: false, detail: "migration folder has no applied row" });
    }

    for (const row of migrationRows.rows) {
      if (!migrationsOnDisk.includes(row.migration_name)) {
        items.push({ kind: "checksum", name: row.migration_name, ok: false, detail: "applied but no longer on disk" });
        continue;
      }
      const onDisk = await checksumOfMigration(row.migration_name);
      if (onDisk === row.checksum) {
        items.push({ kind: "checksum", name: row.migration_name, ok: true });
      } else {
        items.push({
          kind: "checksum",
          name: row.migration_name,
          ok: false,
          detail: "file on disk differs from what was applied — an applied migration was edited",
        });
      }
    }

    // ---------- expected objects: one PASS/FAIL line per expected name ----------
    const compare = (kind: VerifyKind, expected: readonly string[], found: readonly string[]): void => {
      const foundSet = new Set(found);
      for (const name of expected) {
        items.push(
          foundSet.has(name)
            ? { kind, name, ok: true }
            : { kind, name, ok: false, detail: "missing from the database" },
        );
      }
      const expectedSet = new Set(expected);
      for (const name of found) {
        if (!expectedSet.has(name)) {
          items.push({ kind, name, ok: false, detail: "present but not listed in expected-schema.ts" });
        }
      }
    };

    compare("check constraint", EXPECTED_CHECK_CONSTRAINTS, foundCheckConstraints);
    compare("trigger", EXPECTED_TRIGGERS, foundTriggers);
    compare("partial index", EXPECTED_PARTIAL_INDEXES, foundPartialIndexes);

    // Foreign keys are checked one-directionally: only that each hand-written FK
    // listed in expected-schema.ts still exists. Unexpected FKs are NOT flagged
    // (every Prisma-managed foreign key would otherwise show up as a false
    // failure, since none of them are listed there).
    const foundFkSet = new Set(foundForeignKeys);
    for (const name of EXPECTED_FOREIGN_KEYS) {
      items.push(
        foundFkSet.has(name)
          ? { kind: "foreign key", name, ok: true }
          : { kind: "foreign key", name, ok: false, detail: "missing from the database" },
      );
    }

    // Hand-written tables are checked one-directionally for the same reason:
    // every table the Prisma schema declares would otherwise be an unexpected
    // name. Only the names listed here are pinned.
    const foundTableSet = new Set(foundTables);
    for (const name of EXPECTED_TABLES) {
      items.push(
        foundTableSet.has(name)
          ? { kind: "table", name, ok: true }
          : { kind: "table", name, ok: false, detail: "missing from the database" },
      );
    }

    const failures = items.filter((item) => !item.ok);

    const migrationHistory: MigrationHistoryEntry[] = migrationRows.rows.map((row) => ({
      name: row.migration_name,
      finished: row.finished_at !== null,
      rolledBack: row.rolled_back_at !== null,
    }));

    return {
      ok: failures.length === 0,
      databaseName: databaseNameOf(connectionString),
      host: hostOf(connectionString),
      items,
      migrationHistory,
      found: {
        migrations: appliedMigrations,
        tables: foundTables,
        checkConstraints: foundCheckConstraints,
        triggers: foundTriggers,
        partialIndexes: foundPartialIndexes,
        foreignKeys: foundForeignKeys,
      },
      failures,
    };
  } finally {
    await client.end();
  }
}
