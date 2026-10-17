import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Prove the TEST database matches `src/db/expected-schema.ts` before any
    // test runs; a failure aborts the whole run (see tests/global-setup.ts).
    globalSetup: ["./tests/global-setup.ts"],
    // The database tests talk to a remote Neon instance, where a single round
    // trip is routinely a few hundred milliseconds. The 5s default timed tests
    // out mid-transaction, which then poisoned the next test in the file with
    // "current transaction is aborted".
    testTimeout: 30_000,
  },
});
