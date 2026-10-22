import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import {
  describeDatabase,
  fetchConnectedDatabaseName,
  parseTargetArgs,
  resolveConnectionString,
} from "../lib/db-target.js";

config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

/**
 * `pnpm --filter @fabtyna/api db:whoami [-- --url NAME|VALUE]`
 *
 * Read-only. Connects and prints ONLY the database name and its class
 * (dev, test or prod). Never prints the connection string or host.
 * Without `--url` it reads `DIRECT_URL`, the same variable the API and
 * `db:migrate:deploy` use.
 */
async function main(): Promise<void> {
  const options = parseTargetArgs(process.argv.slice(2));
  const { connectionString, source } = resolveConnectionString(options.url, "DIRECT_URL", "db:whoami");
  const name = await fetchConnectedDatabaseName(connectionString);
  console.log(describeDatabase(name));
  console.log(`Connection from: ${source}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`db:whoami could not run: ${message}`);
  process.exit(2);
});
