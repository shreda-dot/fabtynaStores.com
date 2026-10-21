import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Prisma 7 no longer auto-loads `.env`, so load this package's own file
// explicitly (resolved from this file, not from the current working
// directory) before `env()` is evaluated.
config({ path: fileURLToPath(new URL("./.env", import.meta.url)) });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  // Schema/migration commands run over the direct Neon connection so they
  // bypass the pooler: DDL, advisory locks and shadow-database work need a
  // real session, not a PgBouncer transaction pool.
  //
  // The runtime client is configured separately by `src/lib/env.ts` and
  // `src/start.ts`; it also uses `DIRECT_URL` through its driver adapter.
  datasource: {
    url: env("DIRECT_URL"),
  },
});
