import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import { buildApp } from "./app.js";
import { startSessionCleanup } from "./auth/session.js";
import { startIdempotencyCleanup } from "./lib/idempotency.js";
import type { RuntimeEnv } from "./lib/env.js";
import { createPrismaClient } from "./lib/prisma.js";
import { buildLoggerOptions, type LoggerOption } from "./lib/logging.js";

export interface StartedServer {
  app: FastifyInstance;
  prisma: PrismaClient;
  address: string;
}

/**
 * Starts the API with cookie-based server sessions.
 */
export async function startServer(
  env: RuntimeEnv,
  overrides: { port?: number; logger?: boolean | LoggerOption } = {},
): Promise<StartedServer> {
  const prisma = createPrismaClient(env.apiDatabaseUrl, { maxConnections: env.dbPoolMax });
  try {
    const app = buildApp({
      prisma,
      auth: {
        nodeEnv: env.nodeEnv,
        webOrigin: env.webOrigin,
        cookieDomain: env.cookieDomain,
        sessionIdleTimeoutHours: env.sessionIdleTimeoutHours,
        sessionAbsoluteTimeoutDays: env.sessionAbsoluteTimeoutDays,
      },
      trustProxy: env.trustProxy,
      logger: overrides.logger ?? buildLoggerOptions(),
      txTimeouts: env.txTimeouts,
      maxDateRangeDays: env.maxDateRangeDays,
    });

    const stopCleanup = startIdempotencyCleanup(prisma, {
      onError: (error) => app.log.error({ err: error }, "idempotency cleanup failed"),
      onPurged: (count) => {
        if (count > 0) {
          app.log.info({ count }, "purged expired idempotency keys");
        }
      },
    });
    const stopSessionCleanup = startSessionCleanup(prisma, {
      idleTimeoutHours: env.sessionIdleTimeoutHours,
      onError: (error) => app.log.error({ err: error }, "session cleanup failed"),
      onPurged: (count) => {
        if (count > 0) app.log.info({ count }, "purged expired admin sessions");
      },
    });
    app.addHook("onClose", async () => {
      stopCleanup();
      stopSessionCleanup();
      await prisma.$disconnect();
    });

    const address = await app.listen({ port: overrides.port ?? env.port, host: env.host });
    return { app, prisma, address };
  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }
}
