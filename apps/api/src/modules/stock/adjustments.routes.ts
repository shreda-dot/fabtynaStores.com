import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireActor } from "../../auth/actor.js";
import { validationError } from "../../lib/errors.js";
import {
  createAdjustmentSchema,
  listAdjustmentsQuerySchema,
  stockIdempotencyKeySchema,
  stockIdParamsSchema,
} from "./stock.schemas.js";
import type { AdjustmentsService } from "./adjustments.service.js";

function readKey(request: FastifyRequest): string | null {
  const value = request.headers["idempotency-key"];
  if (value === undefined) return null;
  const parsed = stockIdempotencyKeySchema.safeParse(value);
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Invalid Idempotency-Key.", {
      header: "Idempotency-Key",
    });
  }
  return parsed.data;
}

function readId(request: FastifyRequest): string {
  const parsed = stockIdParamsSchema.safeParse(request.params);
  if (!parsed.success) throw validationError("Invalid stock adjustment id.", parsed.error.issues);
  return parsed.data.id;
}

function send(reply: FastifyReply, result: { status: number; body: unknown; replayed: boolean }) {
  if (result.replayed) reply.header("Idempotent-Replayed", "true");
  return reply.status(result.status).send(result.body);
}

export function registerAdjustmentsRoutes(
  app: FastifyInstance,
  deps: { service: AdjustmentsService },
): void {
  app.post("/adjustments", async (request, reply) => {
    const actor = requireActor(request);
    const parsed = createAdjustmentSchema.safeParse(request.body);
    if (!parsed.success) throw validationError("The stock adjustment is not valid.", parsed.error.issues);
    return send(reply, await deps.service.create(parsed.data, actor, readKey(request)));
  });

  app.post("/adjustments/:id/void", async (request, reply) => {
    const actor = requireActor(request);
    return send(reply, await deps.service.void(readId(request), actor, readKey(request)));
  });

  app.get("/adjustments", async (request, reply) => {
    requireActor(request);
    const parsed = listAdjustmentsQuerySchema.safeParse(request.query);
    if (!parsed.success) throw validationError("The adjustment filter is not valid.", parsed.error.issues);
    return reply.status(200).send(await deps.service.list(parsed.data));
  });

  app.get("/adjustments/:id", async (request, reply) => {
    requireActor(request);
    return reply.status(200).send(await deps.service.get(readId(request)));
  });
}
