import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import {
  assertConfirmedDatabase,
  describeDatabase,
  fetchConnectedDatabaseName,
  parseTargetArgs,
  redactConnectionDetails,
  resolveConnectionString,
} from "../lib/db-target.js";

config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

/**
 * `pnpm --filter @fabtyna/api db:migrate:deploy -- --confirm-db <name> [--url NAME|VALUE]`
 *
 * Checks that `--confirm-db` equals the name of the database the server reports,
 * then runs `prisma migrate deploy` (which applies only migrations that are not
 * yet recorded; it never edits an applied one) using `prisma.config.ts`.
 * Without `--url` it reads `DIRECT_URL`, which is what `prisma.config.ts` reads.
 * Prisma's output is filtered so the connection string and host are not printed.
 */
async function main(): Promise<void> {
  const options = parseTargetArgs(process.argv.slice(2), { confirmDb: true });
  const { connectionString } = resolveConnectionString(options.url, "DIRECT_URL", "db:migrate:deploy");

  const connectedName = await fetchConnectedDatabaseName(connectionString);
  assertConfirmedDatabase(connectedName, options.confirmDb);
  console.log(`Applying migrations to ${describeDatabase(connectedName)}`);

  const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
  const result = spawnSync("pnpm", ["exec", "prisma", "migrate", "deploy", "--config", "prisma.config.ts"], {
    cwd: packageRoot,
    env: { ...process.env, DIRECT_URL: connectionString },
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  const output = redactConnectionDetails(`${result.stdout ?? ""}${result.stderr ?? ""}`, connectionString);
  console.log(output.trimEnd());
  process.exit(result.status ?? 1);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`db:migrate:deploy could not run: ${message}`);
  process.exit(1);
});
