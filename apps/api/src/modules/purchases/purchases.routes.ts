import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireActor } from "../../auth/actor.js";
import { validationError } from "../../lib/errors.js";
import {
  createPurchaseDtoSchema,
  idempotencyKeySchema,
  listPurchasesQuerySchema,
  paymentReversalParamsSchema,
  purchaseIdParamsSchema,
  recordPurchasePaymentBodySchema,
  reversePaymentBodySchema,
  zodIssues,
} from "./purchases.schemas.js";
import type { PurchaseResponse, PurchasesService } from "./purchases.service.js";

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

function readPurchaseId(request: FastifyRequest): string {
  const params = purchaseIdParamsSchema.safeParse(request.params);
  if (!params.success) {
    throw validationError("Invalid purchase id.", zodIssues(params.error));
  }
  return params.data.id;
}

function send(reply: FastifyReply, result: PurchaseResponse) {
  if (result.replayed) {
    reply.header("Idempotent-Replayed", "true");
  }
  return reply.status(result.status).send(result.body);
}

export function registerPurchasesRoutes(
  app: FastifyInstance,
  deps: { service: PurchasesService },
): void {
  app.post("/purchases", async (request, reply) => {
    const actor = requireActor(request);
    const idempotencyKey = readIdempotencyKey(request);

    const parsed = createPurchaseDtoSchema.safeParse(request.body);
    if (!parsed.success) {
      throw validationError("The purchase is not valid.", zodIssues(parsed.error));
    }
    return send(reply, await deps.service.createPurchase(parsed.data, actor, idempotencyKey));
  });

  app.get("/purchases", async (request, reply) => {
    requireActor(request);
    const parsed = listPurchasesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw validationError("The purchases filter is not valid.", zodIssues(parsed.error));
    }
    return reply.status(200).send(await deps.service.listPurchases(parsed.data));
  });

  app.get("/purchases/:id", async (request, reply) => {
    requireActor(request);
    return reply.status(200).send(await deps.service.getPurchase(readPurchaseId(request)));
  });

  app.post("/purchases/:id/payments", async (request, reply) => {
    const actor = requireActor(request);
    const purchaseId = readPurchaseId(request);
    const idempotencyKey = readIdempotencyKey(request);

    const parsed = recordPurchasePaymentBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw validationError("The payment is not valid.", zodIssues(parsed.error));
    }
    return send(reply, await deps.service.recordPayment(purchaseId, parsed.data, actor, idempotencyKey));
  });

  app.post("/purchases/:id/payments/:paymentId/reverse", async (request, reply) => {
    const actor = requireActor(request);
    const params = paymentReversalParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw validationError("Invalid purchase or payment id.", zodIssues(params.error));
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

  app.post("/purchases/:id/void", async (request, reply) => {
    const actor = requireActor(request);
    const purchaseId = readPurchaseId(request);
    return send(reply, await deps.service.voidPurchase(purchaseId, actor, readIdempotencyKey(request)));
  });

  app.put("/purchases/:id", async (request, reply) => {
    const actor = requireActor(request);
    const purchaseId = readPurchaseId(request);
    const idempotencyKey = readIdempotencyKey(request);

    const parsed = createPurchaseDtoSchema.safeParse(request.body);
    if (!parsed.success) {
      throw validationError("The purchase is not valid.", zodIssues(parsed.error));
    }
    return send(reply, await deps.service.amendPurchase(purchaseId, parsed.data, actor, idempotencyKey));
  });
}
