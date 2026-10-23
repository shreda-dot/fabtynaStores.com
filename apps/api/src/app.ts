import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import type { PrismaClient } from "../generated/prisma/client.js";
import { registerAuthRoutes } from "./auth/auth.routes.js";
import { registerPasswordResetRoutes } from "./auth/password-reset.routes.js";
import type { SessionConfig } from "./auth/session.js";
import { authenticateRequest, csrfOriginError } from "./auth/session.js";
import { AppError, mapKnownError } from "./lib/errors.js";
import type { LoggerOption } from "./lib/logging.js";
import type { Mailer } from "./lib/mailer.js";
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
import { registerReportsRoutes } from "./modules/reports/reports.routes.js";
import { createReportsService } from "./modules/reports/reports.service.js";

export interface BuildAppOptions {
  prisma: PrismaClient;
  auth: SessionConfig;
  trustProxy: boolean;
  logger?: boolean | LoggerOption;
  now?: () => Date;
  /** Password-reset email delivery. `null`/omitted disables self-service reset. */
  mailer?: Mailer | null;
  /** Defaults to DEFAULT_TX_TIMEOUTS. */
  txTimeouts?: TxTimeouts;
  maxDateRangeDays?: number;
  /** Receives one entry per write transaction (route, ms, statement count). Defaults to the app logger. */
  onTransaction?: (entry: Record<string, unknown>) => void;
  onRoute?: (route: { method: string | string[]; url: string }) => void;
}

const PUBLIC_AUTH_POST_PATHS = new Set([
  "/auth/login",
  "/auth/forgot-password",
  "/auth/reset-password",
]);

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    genReqId: () => randomUUID(),
    trustProxy: options.trustProxy,
  });
  app.register(cookie);
  app.register(cors, {
    origin: options.auth.webOrigin,
    credentials: true,
    allowedHeaders: ["content-type", "idempotency-key"],
    exposedHeaders: ["Idempotent-Replayed", "Retry-After"],
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => ({
      error: {
        code: "RATE_LIMITED",
        message: "Too many sign-in attempts. Try again later.",
        details: null,
      },
    }),
  });
  app.decorateRequest("actor", null);
  app.decorateRequest("adminSessionId", null);
  app.addHook("onRoute", (route) => {
    options.onRoute?.({ method: route.method, url: route.url });
  });
  app.addHook("onRequest", async (request) => {
    if (
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      request.headers.origin !== options.auth.webOrigin
    ) {
      throw csrfOriginError();
    }

    const path = request.url.split("?")[0];
    // The only routes reachable without a session: liveness, sign-in, and the
    // two password-reset endpoints (a locked-out admin has no session by
    // definition). Everything else, including both new routes' CSRF check,
    // is unchanged.
    if (
      (request.method === "GET" && path === "/health") ||
      (request.method === "POST" && PUBLIC_AUTH_POST_PATHS.has(path)) ||
      request.method === "OPTIONS"
    ) {
      return;
    }

    const actor = await authenticateRequest(options.prisma, request, options.auth);
    if (actor === null) {
      throw new AppError(401, "UNAUTHENTICATED", "Sign in to continue.");
    }
    request.actor = actor;
  });

  app.get("/health", async () => ({ status: "ok" }));
  registerAuthRoutes(app, {
    prisma: options.prisma,
    config: options.auth,
    now: options.now,
  });
  registerPasswordResetRoutes(app, {
    prisma: options.prisma,
    config: options.auth,
    mailer: options.mailer ?? null,
    now: options.now,
  });

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
  registerSalesRoutes(app, { service });

  const productsService = createProductsService({
    prisma: options.prisma,
    now: options.now,
    txTimeouts: options.txTimeouts,
    log,
  });
  registerProductsRoutes(app, { service: productsService });
  registerInventoryRoutes(app, { prisma: options.prisma });
  const partiesService = createPartiesService({
    prisma: options.prisma,
    now: options.now,
    txTimeouts: options.txTimeouts,
    maxDateRangeDays: options.maxDateRangeDays,
    log,
  });
  registerPartiesRoutes(app, { service: partiesService });

  const purchasesService = createPurchasesService({
    prisma: options.prisma,
    now: options.now,
    txTimeouts: options.txTimeouts,
    maxDateRangeDays: options.maxDateRangeDays,
    log,
  });
  registerPurchasesRoutes(app, { service: purchasesService });

  const expenseCategoryService = createExpenseCategoryService({
    prisma: options.prisma,
    now: options.now,
    txTimeouts: options.txTimeouts,
    log,
  });
  registerExpenseCategoryRoutes(app, {
    service: expenseCategoryService,
  });
  const expensesService = createExpensesService({
    prisma: options.prisma,
    now: options.now,
    txTimeouts: options.txTimeouts,
    maxDateRangeDays: options.maxDateRangeDays,
    log,
  });
  registerExpensesRoutes(app, { service: expensesService });
  const accountsService = createAccountsService({
    prisma: options.prisma,
    now: options.now,
    txTimeouts: options.txTimeouts,
    maxDateRangeDays: options.maxDateRangeDays,
    log,
  });
  registerAccountsRoutes(app, { service: accountsService });
  const loansService = createLoansService({
    prisma: options.prisma,
    now: options.now,
    txTimeouts: options.txTimeouts,
    log,
  });
  registerLoansRoutes(app, { service: loansService });

  const transfersService = createTransfersService({
    prisma: options.prisma,
    now: options.now,
    txTimeouts: options.txTimeouts,
    maxDateRangeDays: options.maxDateRangeDays,
    log,
  });
  registerTransfersRoutes(app, { service: transfersService });

  const adjustmentsService = createAdjustmentsService({
    prisma: options.prisma,
    now: options.now,
    txTimeouts: options.txTimeouts,
    maxDateRangeDays: options.maxDateRangeDays,
    log,
  });
  registerAdjustmentsRoutes(app, { service: adjustmentsService });

  const reportsService = createReportsService({
    prisma: options.prisma,
    now: options.now,
    maxDateRangeDays: options.maxDateRangeDays,
  });
  registerReportsRoutes(app, { service: reportsService });

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
      if (known.status === 503) {
        reply.header("retry-after", "2");
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
