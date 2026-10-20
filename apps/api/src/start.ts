import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import { assertUnauthenticatedModeAllowed, createDevActorResolver, loadDevActor } from "./auth/actor.js";
import { buildApp } from "./app.js";
import { startIdempotencyCleanup } from "./lib/idempotency.js";
import type { RuntimeEnv } from "./lib/env.js";
import { createPrismaClient } from "./lib/prisma.js";

/** Localhost only until real authentication exists. */
export const LISTEN_HOST = "127.0.0.1";

export interface StartedServer {
  app: FastifyInstance;
  prisma: PrismaClient;
  address: string;
}

/**
 * Starts the API. The guard runs FIRST, before any connection is opened, so a
 * misconfigured production start fails without touching the database.
 */
export async function startServer(
  env: RuntimeEnv,
  overrides: { port?: number; logger?: boolean } = {},
): Promise<StartedServer> {
  assertUnauthenticatedModeAllowed(env);

  const prisma = createPrismaClient(env.apiDatabaseUrl, { maxConnections: env.dbPoolMax });
  try {
    const actor = await loadDevActor(prisma, env.devActorEmail);
    const app = buildApp({
      prisma,
      resolveActor: createDevActorResolver(actor),
      logger: overrides.logger ?? true,
      txTimeouts: env.txTimeouts,
    });

    const stopCleanup = startIdempotencyCleanup(prisma, {
      onError: (error) => app.log.error({ err: error }, "idempotency cleanup failed"),
      onPurged: (count) => {
        if (count > 0) {
          app.log.info({ count }, "purged expired idempotency keys");
        }
      },
    });
    app.addHook("onClose", async () => {
      stopCleanup();
      await prisma.$disconnect();
    });

    const address = await app.listen({ port: overrides.port ?? env.port, host: LISTEN_HOST });
    return { app, prisma, address };
  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }
}
