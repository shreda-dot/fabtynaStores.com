import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { assertNotATestDatabase, seedAdmin } from "../lib/seed-admin.js";
import {
  assertConfirmedDatabase,
  describeDatabase,
  fetchConnectedDatabaseName,
  parseTargetArgs,
  resolveConnectionString,
} from "../lib/db-target.js";

// Prisma 7 and tsx do not load `.env` for us, so load it from the package root
// before any value is read (same pattern as src/lib/env.ts).
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

/**
 * `pnpm --filter @fabtyna/api db:seed:admin -- --confirm-db <name> [--additional] [--url NAME|VALUE]`
 *
 * Creates the first admin account from `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH`,
 * or — with `--additional` — adds a further STAFF account.
 *
 * Safety rules enforced here, on top of `seedAdmin`:
 *   * it writes to `DIRECT_URL` (or `--url`) and **refuses** to run when that
 *     database's name contains "test" or when it equals `TEST_DATABASE_URL`;
 *   * it refuses unless `--confirm-db` equals the name of the database the
 *     server reports (run `db:whoami` first);
 *   * it prints only the created account's email and role — never the hash,
 *     never the connection string.
 *
 * Generate `ADMIN_PASSWORD_HASH` with
 * `pnpm --filter @fabtyna/api hash-password` so the plaintext is never typed on
 * a command line or stored in your shell history.
 */

interface CliOptions {
  additional: boolean;
  url: string | null;
  confirmDb: string | null;
}

function parseArgs(argv: string[]): CliOptions {
  const parsed = parseTargetArgs(argv, { confirmDb: true, flags: ["--additional"] });
  return { additional: parsed.flags.has("--additional"), url: parsed.url, confirmDb: parsed.confirmDb };
}

async function main(): Promise<void> {
  const { additional, url, confirmDb } = parseArgs(process.argv.slice(2));

  const { connectionString } = resolveConnectionString(url, "DIRECT_URL", "db:seed:admin");
  assertNotATestDatabase(connectionString, process.env.TEST_DATABASE_URL ?? null);

  // The name is read from the server, not from the URL text, so a wrong URL cannot pass.
  const connectedName = await fetchConnectedDatabaseName(connectionString);
  assertConfirmedDatabase(connectedName, confirmDb);
  console.log(`Seeding ${describeDatabase(connectedName)}`);

  const email = process.env.ADMIN_EMAIL ?? "";
  const passwordHash = process.env.ADMIN_PASSWORD_HASH ?? "";
  if (email.trim() === "") {
    throw new Error("ADMIN_EMAIL is not set.");
  }
  if (passwordHash.trim() === "") {
    throw new Error("ADMIN_PASSWORD_HASH is not set.");
  }

  const created = await seedAdmin(connectionString, { email, passwordHash, additional });
  console.log(`${created.email} (role: ${created.role})`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`db:seed:admin could not run: ${message}`);
  process.exit(1);
});
