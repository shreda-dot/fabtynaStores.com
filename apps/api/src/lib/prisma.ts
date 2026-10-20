import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";

export interface PrismaClientOptions {
  /** Maximum connections in the node-postgres pool. Defaults to the driver's own default. */
  maxConnections?: number;
}

/**
 * Builds a Prisma client for one connection string.
 *
 * Prisma 7 requires a driver adapter, so the client connects through
 * `@prisma/adapter-pg` (node-postgres) rather than Prisma's own engine.
 * The running API passes the **direct** `DIRECT_URL` with a small pool: its
 * transactions take row locks and run several statements, which the pooled
 * endpoint drops mid-flight. The constraint and API tests pass the direct test
 * URL. Schema and migration commands never use this client — they connect with
 * `DIRECT_URL` via `prisma.config.ts`.
 */
export function createPrismaClient(
  connectionString: string,
  options: PrismaClientOptions = {},
): PrismaClient {
  if (connectionString.trim() === "") {
    throw new Error("A connection string is required to create the Prisma client.");
  }

  const adapter = new PrismaPg({
    connectionString,
    ...(options.maxConnections === undefined ? {} : { max: options.maxConnections }),
  });

  return new PrismaClient({
    adapter,
    log: ["warn", "error"],
  });
}

export type { PrismaClient };
