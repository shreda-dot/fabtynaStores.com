import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { ActorResolver } from "./auth/actor.js";
import { AppError, mapKnownError } from "./lib/errors.js";
import type { TxTimeouts } from "./lib/tx-options.js";
import { registerPurchasesRoutes } from "./modules/purchases/purchases.routes.js";
import { createPurchasesService } from "./modules/purchases/purchases.service.js";
import { registerExpenseCategoryRoutes } from "./modules/expenses/expense-categories.routes.js";
import { createExpenseCategoryService } from "./modules/expenses/expense-categories.service.js";
import { registerExpensesRoutes } from "./modules/expenses/expenses.routes.js";
import { createExpensesService } from "./modules/expenses/expenses.service.js";
import { registerAccountsRoutes } from "./modules/accounts/accounts.routes.js";
import { createAccountsService } from "./modules/accounts/accounts.service.js";
import { registerLoansRoutes } from "./modules/loans/loans.routes.js";
import { createLoansService } from "./modules/loans/loans.service.js";
import { registerSalesRoutes } from "./modules/sales/sales.routes.js";
import { createSalesService } from "./modules/sales/sales.service.js";
import { registerTransfersRoutes } from "./modules/stock/transfers.routes.js";
import { createTransfersService } from "./modules/stock/transfers.service.js";
import { registerAdjustmentsRoutes } from "./modules/stock/adjustments.routes.js";
import { createAdjustmentsService } from "./modules/stock/adjustments.service.js";
import { registerProductsRoutes } from "./modules/products/products.routes.js";
import { createProductsService } from "./modules/products/products.service.js";
import { registerInventoryRoutes } from "./modules/stock/inventory.routes.js";
import { registerPartiesRoutes } from "./modules/parties/parties.routes.js";
import { createPartiesService } from "./modules/parties/parties.service.js";

export interface BuildAppOptions {
  prisma: PrismaClient;
  resolveActor: ActorResolver;
  logger?: boolean;
  now?: () => Date;
  /** Defaults to DEFAULT_TX_TIMEOUTS. */
  txTimeouts?: TxTimeouts;
  maxDateRangeDays?: number;
  /** Receives one entry per write transaction (route, ms, statement count). Defaults to the app logger. */
  onTransaction?: (entry: Record<string, unknown>) => void;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    genReqId: () => randomUUID(),
  });

  app.get("/health", async () => ({ status: "ok" }));

  const log = (entry: Record<string, unknown>) => {
    app.log.info(entry, "tx");
    options.onTransaction?.(entry);
  };
  const service = createSalesService({
    prisma: options.prisma,
    now: options.now,
    txTimeouts: options.txTimeouts,
    maxDateRangeDays: options.maxDateRangeDays,
    log,
  });
  registerSalesRoutes(app, { service, resolveActor: options.resolveActor });

  const productsService = createProductsService({
    prisma: options.prisma,
    now: options.now,
    txTimeouts: options.txTimeouts,
    log,
  });
  registerProductsRoutes(app, { service: productsService, resolveActor: options.resolveActor });
  registerInventoryRoutes(app, { prisma: options.prisma, resolveActor: options.resolveActor });
  const partiesService = createPartiesService({
    prisma: options.prisma,
    now: options.now,
    txTimeouts: options.txTimeouts,
    maxDateRangeDays: options.maxDateRangeDays,
    log,
  });
  registerPartiesRoutes(app, { service: partiesService, resolveActor: options.resolveActor });

  const purchasesService = createPurchasesService({
    prisma: options.prisma,
    now: options.now,
    txTimeouts: options.txTimeouts,
    maxDateRangeDays: options.maxDateRangeDays,
    log,
  });
  registerPurchasesRoutes(app, { service: purchasesService, resolveActor: options.resolveActor });

  const expenseCategoryService = createExpenseCategoryService({
    prisma: options.prisma,
    now: options.now,
    txTimeouts: options.txTimeouts,
    log,
  });
  registerExpenseCategoryRoutes(app, {
    service: expenseCategoryService,
    resolveActor: options.resolveActor,
  });
  const expensesService = createExpensesService({
    prisma: options.prisma,
    now: options.now,
    txTimeouts: options.txTimeouts,
    maxDateRangeDays: options.maxDateRangeDays,
    log,
  });
  registerExpensesRoutes(app, { service: expensesService, resolveActor: options.resolveActor });
  const accountsService = createAccountsService({
    prisma: options.prisma,
    now: options.now,
    txTimeouts: options.txTimeouts,
    maxDateRangeDays: options.maxDateRangeDays,
    log,
  });
  registerAccountsRoutes(app, { service: accountsService, resolveActor: options.resolveActor });
  const loansService = createLoansService({
    prisma: options.prisma,
    now: options.now,
    txTimeouts: options.txTimeouts,
    log,
  });
  registerLoansRoutes(app, { service: loansService, resolveActor: options.resolveActor });

  const transfersService = createTransfersService({
    prisma: options.prisma,
    now: options.now,
    txTimeouts: options.txTimeouts,
    maxDateRangeDays: options.maxDateRangeDays,
    log,
  });
  registerTransfersRoutes(app, { service: transfersService, resolveActor: options.resolveActor });

  const adjustmentsService = createAdjustmentsService({
    prisma: options.prisma,
    now: options.now,
    txTimeouts: options.txTimeouts,
    maxDateRangeDays: options.maxDateRangeDays,
    log,
  });
  registerAdjustmentsRoutes(app, { service: adjustmentsService, resolveActor: options.resolveActor });

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
