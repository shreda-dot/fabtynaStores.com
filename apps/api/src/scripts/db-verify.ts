import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { runDbVerify, type VerifyResult } from "../db/verify.js";

// Prisma 7 and tsx do not load `.env` for us, so load it from the package root
// before any value is read (same pattern as src/lib/env.ts).
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

/**
 * `pnpm --filter @fabtyna/api db:verify`
 *
 * Read-only. Connects to the database in `DATABASE_URL` (or the one named by
 * `--url`), then proves that every migration, CHECK constraint, trigger and
 * partial index listed in `src/db/expected-schema.ts` is present, applied and
 * unmodified. Prints one PASS/FAIL line per item and exits non-zero if anything
 * is missing. It never prints the connection string — only the database name
 * and host.
 *
 * Usage:
 *   pnpm --filter @fabtyna/api db:verify
 *   pnpm --filter @fabtyna/api db:verify -- --url TEST_DATABASE_URL
 *   pnpm --filter @fabtyna/api db:verify -- --url "<postgres://...>"
 */

interface CliOptions {
  /** Either an env var name (e.g. DATABASE_URL) or a literal connection string. */
  url: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { url: "DATABASE_URL" };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--url") {
      const value = argv[index + 1];
      if (value === undefined || value === "") {
        throw new Error("--url requires a value: an environment variable name or a connection string.");
      }
      options.url = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--url=")) {
      const value = arg.slice("--url=".length);
      if (value === "") {
        throw new Error("--url requires a value: an environment variable name or a connection string.");
      }
      options.url = value;
      continue;
    }

    throw new Error(`Unknown argument "${arg}". Supported: --url <NAME|VALUE>.`);
  }

  return options;
}

/** Resolves `--url` to a connection string: a literal URL, or an env var name. */
function resolveConnectionString(requested: string): { connectionString: string; source: string } {
  if (/^postgres(ql)?:\/\//.test(requested)) {
    return { connectionString: requested, source: "--url (literal)" };
  }

  const value = (process.env[requested] ?? "").trim();
  if (value === "") {
    throw new Error(
      `${requested} is empty or not set. Refusing to run db:verify without a target database.`,
    );
  }
  return { connectionString: value, source: requested };
}

function report(result: VerifyResult, source: string): void {
  console.log(`Target: ${result.databaseName} (host ${result.host})`);
  console.log(`Connection from: ${source}`);
  console.log("");

  const kinds: Array<{ label: string; kind: VerifyResult["items"][number]["kind"] }> = [
    { label: "Migrations", kind: "migration" },
    { label: "Migration file checksums", kind: "checksum" },
    { label: "CHECK constraints", kind: "check constraint" },
    { label: "Triggers", kind: "trigger" },
    { label: "Partial indexes", kind: "partial index" },
    { label: "Hand-written foreign keys", kind: "foreign key" },
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
  const options = parseArgs(process.argv.slice(2));
  const { connectionString, source } = resolveConnectionString(options.url);

  const result = await runDbVerify(connectionString);
  report(result, source);

  process.exit(result.ok ? 0 : 1);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`db:verify could not run: ${message}`);
  process.exit(2);
});
