import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { ActorResolver } from "./auth/actor.js";
import { AppError, mapKnownError } from "./lib/errors.js";
import { registerSalesRoutes } from "./modules/sales/sales.routes.js";
import { createSalesService } from "./modules/sales/sales.service.js";

export interface BuildAppOptions {
  prisma: PrismaClient;
  resolveActor: ActorResolver;
  logger?: boolean;
  now?: () => Date;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    genReqId: () => randomUUID(),
  });

  app.get("/health", async () => ({ status: "ok" }));

  const service = createSalesService({
    prisma: options.prisma,
    now: options.now,
    log: (entry) => app.log.info(entry, "sales"),
  });
  registerSalesRoutes(app, { service, resolveActor: options.resolveActor });

  app.setNotFoundHandler((request, reply) => {
    const error = new AppError(404, "NOT_FOUND", "Route not found.", {
      method: request.method,
      path: request.url.split("?")[0],
    });
    return reply.status(404).send(error.toEnvelope());
  });

  app.setErrorHandler((error, request, reply) => {
    // Fastify's own parse/content-type failures (malformed JSON etc.) are client errors.
    const fastifyStatus = (error as { statusCode?: number }).statusCode;
    if (
      !(error instanceof AppError) &&
      typeof fastifyStatus === "number" &&
      fastifyStatus >= 400 &&
      fastifyStatus < 500
    ) {
      const mapped = new AppError(400, "VALIDATION", "The request could not be read as valid JSON.", null);
      return reply.status(400).send(mapped.toEnvelope());
    }

    const known = mapKnownError(error);
    if (known !== null) {
      if (known.status >= 500) {
        request.log.error({ err: error }, "request failed");
      }
      return reply.status(known.status).send(known.toEnvelope());
    }

    request.log.error({ err: error, requestId: request.id }, "unexpected error");
    const internal = new AppError(500, "INTERNAL", "Something went wrong. Please try again.", {
      requestId: request.id,
    });
    return reply.status(500).send(internal.toEnvelope());
  });

  return app;
}
