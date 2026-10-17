import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Prove the TEST database matches `src/db/expected-schema.ts` before any
    // test runs; a failure aborts the whole run (see tests/global-setup.ts).
    globalSetup: ["./tests/global-setup.ts"],
  },
});
