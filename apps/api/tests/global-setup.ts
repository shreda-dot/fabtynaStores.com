import { assertTestDatabaseIsVerified } from "./test-db.js";

/**
 * Vitest global setup.
 *
 * Every test run proves the TEST database still matches
 * `src/db/expected-schema.ts` before a single test body executes. If a
 * migration is missing, unfinished, rolled back, or an applied migration file
 * was edited after the fact, the whole run aborts with a non-zero exit instead
 * of failing deep inside an unrelated assertion.
 */
export default async function globalSetup(): Promise<void> {
  await assertTestDatabaseIsVerified();
}
