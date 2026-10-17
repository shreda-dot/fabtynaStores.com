import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { runDbAudit, type AuditResult } from "../db/audit.js";

// Prisma 7 and tsx do not load `.env` for us, so load it from the package root
// before any value is read (same pattern as src/lib/env.ts).
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

/**
 * `pnpm --filter @fabtyna/api db:audit`
 *
 * Read-only counterpart of `db:verify`. `db:verify` proves that every rule is
 * *installed*; this proves that the data still *obeys* the rules that cannot be
 * expressed as a constraint — `totalKobo` = Σ line totals, `paidKobo` = Σ
 * payments, the ledger entries match the documents they came from, and
 * `stock_balances` matches the movement log.
 *
 * Connects to the database in `DATABASE_URL` (or the one named by `--url`),
 * prints one line per check with the offending rows, and exits non-zero if any
 * *fatal* check returns a row. `known` checks describe a documented, deliberate
 * gap and never fail the run. It never prints the connection string — only the
 * database name and host.
 *
 * Usage:
 *   pnpm --filter @fabtyna/api db:audit
 *   pnpm --filter @fabtyna/api db:audit -- --url TEST_DATABASE_URL
 *   pnpm --filter @fabtyna/api db:audit -- --url "<postgres://...>"
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
      `${requested} is empty or not set. Refusing to run db:audit without a target database.`,
    );
  }
  return { connectionString: value, source: requested };
}

function report(result: AuditResult, source: string): void {
  console.log(`Target: ${result.databaseName} (host ${result.host})`);
  console.log(`Connection from: ${source}`);
  console.log("");

  for (const check of result.checks) {
    if (check.error !== undefined) {
      console.log(`ERROR ${check.name}`);
      console.log(`      ${check.error}`);
      console.log("");
      continue;
    }

    const mark = check.severity === "known" ? "INFO" : check.rowCount === 0 ? "PASS" : "FAIL";
    console.log(`${mark} ${check.name}  (${check.rowCount} row${check.rowCount === 1 ? "" : "s"})`);
    console.log(`     ${check.description}`);

    for (const row of check.rows) {
      const pairs = Object.entries(row).map(([key, value]) => `${key}=${String(value)}`);
      console.log(`     - ${pairs.join("  ")}`);
    }
    if (check.rowCount > check.rows.length) {
      console.log(`     - ... ${check.rowCount - check.rows.length} more`);
    }
    console.log("");
  }

  if (result.ok) {
    console.log(`RESULT: PASS — no drift detected on ${result.databaseName}.`);
  } else {
    const failed = result.checks.filter(
      (check) => check.error !== undefined || (check.severity === "fatal" && check.rowCount > 0),
    );
    console.log(`RESULT: FAIL — ${failed.length} check(s) reported drift on ${result.databaseName}.`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { connectionString, source } = resolveConnectionString(options.url);

  const result = await runDbAudit(connectionString);
  report(result, source);

  process.exit(result.ok ? 0 : 1);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`db:audit could not run: ${message}`);
  process.exit(2);
});
