import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { assertNotATestDatabase, seedAdmin } from "../lib/seed-admin.js";

// Prisma 7 and tsx do not load `.env` for us, so load it from the package root
// before any value is read (same pattern as src/lib/env.ts).
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

/**
 * `pnpm --filter @fabtyna/api db:seed:admin [-- --additional]`
 *
 * Creates the first admin account from `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH`,
 * or — with `--additional` — adds a further STAFF account.
 *
 * Safety rules enforced here, on top of `seedAdmin`:
 *   * it writes to `DATABASE_URL` and **refuses** to run when that database's
 *     name contains "test" or when `DATABASE_URL` equals `TEST_DATABASE_URL`;
 *   * it prints only the created account's email and role — never the hash,
 *     never the connection string.
 *
 * Generate `ADMIN_PASSWORD_HASH` with
 * `pnpm --filter @fabtyna/api hash-password` so the plaintext is never typed on
 * a command line or stored in your shell history.
 */

interface CliOptions {
  additional: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  let additional = false;

  for (const arg of argv) {
    if (arg === "--additional") {
      additional = true;
      continue;
    }
    throw new Error(`Unknown argument "${arg}". Supported: --additional.`);
  }

  return { additional };
}

async function main(): Promise<void> {
  const { additional } = parseArgs(process.argv.slice(2));

  const connectionString = (process.env.DATABASE_URL ?? "").trim();
  if (connectionString === "") {
    throw new Error("DATABASE_URL is not set.");
  }
  assertNotATestDatabase(connectionString, process.env.TEST_DATABASE_URL ?? null);

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
