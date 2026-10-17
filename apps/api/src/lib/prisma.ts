import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";

/**
 * Builds a Prisma client for one connection string.
 *
 * Prisma 7 requires a driver adapter, so the client connects through
 * `@prisma/adapter-pg` (node-postgres) rather than Prisma's own engine.
 * The running API passes the **pooled** `DATABASE_URL`; the constraint tests
 * pass `TEST_DATABASE_URL`. Schema and migration commands never use this
 * client — they connect with `DIRECT_URL` via `prisma.config.ts`.
 */
export function createPrismaClient(connectionString: string): PrismaClient {
  if (connectionString.trim() === "") {
    throw new Error("A connection string is required to create the Prisma client.");
  }

  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({
    adapter,
    log: ["warn", "error"],
  });
}

export type { PrismaClient };
