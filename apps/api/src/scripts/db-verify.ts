import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { runDbVerify, type VerifyResult } from "../db/verify.js";
import { describeDatabase, parseTargetArgs, resolveConnectionString } from "../lib/db-target.js";

// Prisma 7 and tsx do not load `.env` for us, so load it from the package root
// before any value is read (same pattern as src/lib/env.ts).
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

/**
 * `pnpm --filter @fabtyna/api db:verify`
 *
 * Read-only. Connects to the database in `DIRECT_URL` (or the one named by
 * `--url`), then proves that every migration, CHECK constraint, trigger and
 * partial index listed in `src/db/expected-schema.ts` is present, applied and
 * unmodified. Prints one PASS/FAIL line per item and exits non-zero if anything
 * is missing. It never prints the connection string or host — only the
 * database name and its class (dev, test or prod).
 *
 * Usage:
 *   pnpm --filter @fabtyna/api db:verify
 *   pnpm --filter @fabtyna/api db:verify -- --url TEST_DATABASE_URL
 *   pnpm --filter @fabtyna/api db:verify -- --url "<postgres://...>"
 */

function report(result: VerifyResult, source: string): void {
  console.log(`Target: ${describeDatabase(result.databaseName)}`);
  console.log(`Connection from: ${source}`);
  console.log("");

  const kinds: Array<{ label: string; kind: VerifyResult["items"][number]["kind"] }> = [
    { label: "Migrations", kind: "migration" },
    { label: "Migration file checksums", kind: "checksum" },
    { label: "Hand-written tables", kind: "table" },
    { label: "CHECK constraints", kind: "check constraint" },
    { label: "Triggers", kind: "trigger" },
    { label: "Partial indexes", kind: "partial index" },
    { label: "Hand-written foreign keys", kind: "foreign key" },
    { label: "Sequences", kind: "sequence" },
    { label: "Indexes", kind: "index" },
  ];

  for (const { label, kind } of kinds) {
    const items = result.items.filter((item) => item.kind === kind);
    const failed = items.filter((item) => !item.ok);
    console.log(`${label}: ${items.length - failed.length} PASS / ${failed.length} FAIL`);

    for (const item of items) {
      const mark = item.ok ? "PASS" : "FAIL";
      const detail = item.detail === undefined ? "" : `  <- ${item.detail}`;
      console.log(`  ${mark} ${item.name}${detail}`);
    }
    console.log("");
  }

  const found = result.found;
  console.log("Migration history (_prisma_migrations)");
  for (const entry of result.migrationHistory) {
    console.log(
      `  ${entry.name}  finished=${entry.finished ? "yes" : "NO"}  rolled_back=${entry.rolledBack ? "YES" : "no"}`,
    );
  }
  console.log("");

  console.log("Inventory");
  console.log(`  applied migrations : ${found.migrations.length} (${found.migrations.join(", ")})`);
  console.log(`  tables (all)       : ${found.tables.length}`);
  console.log(`  CHECK constraints  : ${found.checkConstraints.length}`);
  console.log(`    ${found.checkConstraints.join("\n    ")}`);
  console.log(`  triggers           : ${found.triggers.length}`);
  console.log(`  partial indexes    : ${found.partialIndexes.length}`);
  console.log(`  foreign keys (all) : ${found.foreignKeys.length}`);
  console.log("");

  if (result.ok) {
    console.log(`RESULT: PASS — ${result.databaseName} matches expected-schema.ts.`);
  } else {
    console.log(`RESULT: FAIL — ${result.failures.length} item(s) failed on ${result.databaseName}.`);
  }
}

async function main(): Promise<void> {
  const options = parseTargetArgs(process.argv.slice(2));
  const { connectionString, source } = resolveConnectionString(options.url, "DIRECT_URL", "db:verify");

  const result = await runDbVerify(connectionString);
  report(result, source);

  process.exit(result.ok ? 0 : 1);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`db:verify could not run: ${message}`);
  process.exit(2);
});
