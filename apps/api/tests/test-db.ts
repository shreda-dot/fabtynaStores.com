import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { resolveSslConfig } from "../src/lib/ssl.js";
import { runDbVerify } from "../src/db/verify.js";

// Prisma 7 and vitest do not load `.env` for us, so load this package's file
// explicitly (resolved from this file, not from the current working directory).
config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

/** Reads just the database name out of a connection string. */
export function databaseNameOf(connectionString: string): string {
  return new URL(connectionString).pathname.replace(/^\//, "");
}

/**
 * Refuses to run unless a dedicated test database is configured:
 *   - `TEST_DATABASE_URL` must be set;
 *   - it must not equal the dev `DATABASE_URL`;
 *   - its database name must contain "test".
 * Throws at call time so a test file refuses to run rather than silently
 * pointing at the wrong database.
 */
export function resolveTestConnectionString(): string {
  const testUrl = (process.env.TEST_DATABASE_URL ?? "").trim();
  const devUrl = (process.env.DATABASE_URL ?? "").trim();

  if (testUrl === "") {
    throw new Error("TEST_DATABASE_URL is not set — refusing to run the constraint tests.");
  }
  if (devUrl !== "" && testUrl === devUrl) {
    throw new Error(
      "TEST_DATABASE_URL equals DATABASE_URL — refusing to run the constraint tests against the dev database.",
    );
  }

  const dbName = databaseNameOf(testUrl);
  if (!dbName.toLowerCase().includes("test")) {
    throw new Error(
      `TEST_DATABASE_URL points at database "${dbName}", whose name does not contain "test" — refusing to run.`,
    );
  }

  // Prefer the direct (non-pooled) connection when one is provided.
  const effective = (process.env.TEST_DIRECT_URL ?? "").trim() || testUrl;

  for (const candidate of [testUrl, effective]) {
    if (new URL(candidate).hostname.toLowerCase().includes("-pooler")) {
      throw new Error(
        "TEST_DATABASE_URL points at a pooled Neon endpoint (host contains \"-pooler\") — refusing to run. " +
          "The tests use long-lived sessions, explicit transactions and concurrent clients, and the pooler " +
          "drops those connections (\"Connection terminated unexpectedly\"). Set TEST_DATABASE_URL to the " +
          "direct (non-pooled) Neon endpoint.",
      );
    }
  }

  // Fail early (without printing the URL) if SSL would be disabled for a remote host.
  resolveSslConfig(effective);
  return effective;
}

/**
 * Runs `db:verify` against the TEST database and throws if anything listed in
 * `src/db/expected-schema.ts` is missing, unfinished, rolled back, or edited.
 * The tests call this before touching the database so a schema drift is caught
 * as a setup failure rather than as confusing assertion failures.
 */
export async function assertTestDatabaseIsVerified(): Promise<void> {
  const result = await runDbVerify(resolveTestConnectionString());

  if (!result.ok) {
    const detail = result.failures
      .map((item) => `  - ${item.kind} ${item.name}${item.detail === undefined ? "" : ` (${item.detail})`}`)
      .join("\n");
    throw new Error(
      `db:verify FAILED for ${result.databaseName}; refusing to run the tests.\n${detail}`,
    );
  }
}
