import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ActorResolver } from "../../auth/actor.js";
import { validationError } from "../../lib/errors.js";
import {
  createSaleDtoSchema,
  idempotencyKeySchema,
  listSalesQuerySchema,
  paymentReversalParamsSchema,
  recordPaymentDtoSchema,
  reversePaymentBodySchema,
  saleIdParamsSchema,
  zodIssues,
} from "./sales.schemas.js";
import type { SaleResponse, SalesService } from "./sales.service.js";

function readIdempotencyKey(request: FastifyRequest): string | null {
  const rawKey = request.headers["idempotency-key"];
  if (rawKey === undefined) {
    return null;
  }
  const parsedKey = idempotencyKeySchema.safeParse(rawKey);
  if (!parsedKey.success) {
    throw validationError(parsedKey.error.issues[0]?.message ?? "Invalid Idempotency-Key.", {
      header: "Idempotency-Key",
    });
  }
  return parsedKey.data;
}

function readSaleId(request: FastifyRequest): string {
  const params = saleIdParamsSchema.safeParse(request.params);
  if (!params.success) {
    throw validationError("Invalid sale id.", zodIssues(params.error));
  }
  return params.data.id;
}

function send(reply: FastifyReply, result: SaleResponse) {
  if (result.replayed) {
    reply.header("Idempotent-Replayed", "true");
  }
  return reply.status(result.status).send(result.body);
}

export function registerSalesRoutes(
  app: FastifyInstance,
  deps: { service: SalesService; resolveActor: ActorResolver },
): void {
  app.post("/sales", async (request, reply) => {
    const actor = await deps.resolveActor(request);
    const idempotencyKey = readIdempotencyKey(request);

    const parsed = createSaleDtoSchema.safeParse(request.body);
    if (!parsed.success) {
      throw validationError("The sale is not valid.", zodIssues(parsed.error));
    }
    return send(reply, await deps.service.createSale(parsed.data, actor, idempotencyKey));
  });

  app.get("/sales", async (request, reply) => {
    await deps.resolveActor(request);
    const parsed = listSalesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw validationError("The sales filter is not valid.", zodIssues(parsed.error));
    }
    return reply.status(200).send(await deps.service.listSales(parsed.data));
  });

  app.get("/sales/:id", async (request, reply) => {
    await deps.resolveActor(request);
    const sale = await deps.service.getSale(readSaleId(request));
    return reply.status(200).send(sale);
  });

  app.post("/sales/:id/payments", async (request, reply) => {
    const actor = await deps.resolveActor(request);
    const saleId = readSaleId(request);
    const idempotencyKey = readIdempotencyKey(request);

    const parsed = recordPaymentDtoSchema.safeParse(request.body);
    if (!parsed.success) {
      throw validationError("The payment is not valid.", zodIssues(parsed.error));
    }
    return send(reply, await deps.service.recordPayment(saleId, parsed.data, actor, idempotencyKey));
  });

  app.post("/sales/:id/payments/:paymentId/reverse", async (request, reply) => {
    const actor = await deps.resolveActor(request);
    const params = paymentReversalParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw validationError("Invalid sale or payment id.", zodIssues(params.error));
    }
    const idempotencyKey = readIdempotencyKey(request);
    const parsed = reversePaymentBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw validationError("The reversal is not valid.", zodIssues(parsed.error));
    }
    return send(
      reply,
      await deps.service.reversePayment(params.data.id, params.data.paymentId, parsed.data, actor, idempotencyKey),
    );
  });

  app.post("/sales/:id/void", async (request, reply) => {
    const actor = await deps.resolveActor(request);
    const saleId = readSaleId(request);
    const idempotencyKey = readIdempotencyKey(request);
    return send(reply, await deps.service.voidSale(saleId, actor, idempotencyKey));
  });

  app.put("/sales/:id", async (request, reply) => {
    const actor = await deps.resolveActor(request);
    const saleId = readSaleId(request);
    const idempotencyKey = readIdempotencyKey(request);

    const parsed = createSaleDtoSchema.safeParse(request.body);
    if (!parsed.success) {
      throw validationError("The sale is not valid.", zodIssues(parsed.error));
    }
    return send(reply, await deps.service.amendSale(saleId, parsed.data, actor, idempotencyKey));
  });
}
