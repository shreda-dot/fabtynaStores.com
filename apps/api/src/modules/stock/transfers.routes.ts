import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ActorResolver } from "../../auth/actor.js";
import { validationError } from "../../lib/errors.js";
import {
  createTransferSchema,
  listTransfersQuerySchema,
  stockIdempotencyKeySchema,
  stockIdParamsSchema,
} from "./stock.schemas.js";
import type { TransfersService } from "./transfers.service.js";

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
  if (!parsed.success) throw validationError("Invalid stock transfer id.", parsed.error.issues);
  return parsed.data.id;
}

function send(reply: FastifyReply, result: { status: number; body: unknown; replayed: boolean }) {
  if (result.replayed) reply.header("Idempotent-Replayed", "true");
  return reply.status(result.status).send(result.body);
}

export function registerTransfersRoutes(
  app: FastifyInstance,
  deps: { service: TransfersService; resolveActor: ActorResolver },
): void {
  app.post("/transfers", async (request, reply) => {
    const actor = await deps.resolveActor(request);
    const parsed = createTransferSchema.safeParse(request.body);
    if (!parsed.success) throw validationError("The stock transfer is not valid.", parsed.error.issues);
    return send(reply, await deps.service.create(parsed.data, actor, readKey(request)));
  });

  app.get("/transfers", async (request, reply) => {
    await deps.resolveActor(request);
    const parsed = listTransfersQuerySchema.safeParse(request.query);
    if (!parsed.success) throw validationError("The transfer filter is not valid.", parsed.error.issues);
    return reply.status(200).send(await deps.service.list(parsed.data));
  });

  app.get("/transfers/:id", async (request, reply) => {
    await deps.resolveActor(request);
    return reply.status(200).send(await deps.service.get(readId(request)));
  });
}
