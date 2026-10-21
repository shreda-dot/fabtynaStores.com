import type { FastifyInstance } from "fastify";
import { requireActor } from "../../auth/actor.js";
import { validationError } from "../../lib/errors.js";
import {
  dashboardQuerySchema,
  financialPositionQuerySchema,
  moneyFlowQuerySchema,
  productSalesQuerySchema,
  salesSummaryQuerySchema,
} from "./reports.schemas.js";
import type { createReportsService } from "./reports.service.js";

type ReportsService = ReturnType<typeof createReportsService>;

export function registerReportsRoutes(
  app: FastifyInstance,
  deps: { service: ReportsService },
): void {
  app.get("/reports/sales-summary", async (request, reply) => {
    requireActor(request);
    const parsed = salesSummaryQuerySchema.safeParse(request.query);
    if (!parsed.success) throw validationError("The sales-summary filter is not valid.", parsed.error.issues);
    return reply.status(200).send(await deps.service.salesSummary(parsed.data));
  });

  app.get("/reports/dashboard", async (request, reply) => {
    requireActor(request);
    const parsed = dashboardQuerySchema.safeParse(request.query);
    if (!parsed.success) throw validationError("The dashboard date is not valid.", parsed.error.issues);
    return reply.status(200).send(await deps.service.dashboard(parsed.data.date));
  });

  app.get("/reports/product-sales", async (request, reply) => {
    requireActor(request);
    const parsed = productSalesQuerySchema.safeParse(request.query);
    if (!parsed.success) throw validationError("The product-sales filter is not valid.", parsed.error.issues);
    return reply.status(200).send(await deps.service.productSales(parsed.data));
  });

  app.get("/reports/money-flow", async (request, reply) => {
    requireActor(request);
    const parsed = moneyFlowQuerySchema.safeParse(request.query);
    if (!parsed.success) throw validationError("The money-flow filter is not valid.", parsed.error.issues);
    return reply.status(200).send(await deps.service.moneyFlow(parsed.data));
  });

  app.get("/reports/financial-position", async (request, reply) => {
    requireActor(request);
    const parsed = financialPositionQuerySchema.safeParse(request.query);
    if (!parsed.success) throw validationError("The financial-position options are not valid.", parsed.error.issues);
    return reply.status(200).send(await deps.service.financialPosition(parsed.data));
  });
}
