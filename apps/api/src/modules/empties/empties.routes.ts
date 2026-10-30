import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireActor } from "../../auth/actor.js";
import { validationError } from "../../lib/errors.js";
import {
  balanceListQuerySchema,
  createMovementSchema,
  createOwnerSchema,
  createTypeSchema,
  emptiesIdParamsSchema,
  emptiesIdempotencyKeySchema,
  listMovementsQuerySchema,
  ownerListQuerySchema,
  patchTypeSchema,
  renameOwnerSchema,
  reverseMovementSchema,
  typeListQuerySchema,
} from "./empties.schemas.js";
import type { EmptiesService } from "./empties.service.js";

function readKey(request: FastifyRequest): string | null {
  const value = request.headers["idempotency-key"];
  if (value === undefined) return null;
  const parsed = emptiesIdempotencyKeySchema.safeParse(value);
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Invalid Idempotency-Key.", {
      header: "Idempotency-Key",
    });
  }
  return parsed.data;
}

function readId(request: FastifyRequest): string {
  const parsed = emptiesIdParamsSchema.safeParse(request.params);
  if (!parsed.success) throw validationError("Invalid empties id.", parsed.error.issues);
  return parsed.data.id;
}

function send(reply: FastifyReply, result: { status: number; body: unknown; replayed: boolean }) {
  if (result.replayed) reply.header("Idempotent-Replayed", "true");
  return reply.status(result.status).send(result.body);
}

export function registerEmptiesRoutes(
  app: FastifyInstance,
  deps: { service: EmptiesService },
): void {
  // ---------- owners ----------
  app.get("/empties/owners", async (request, reply) => {
    requireActor(request);
    const parsed = ownerListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw validationError("The empties-owner filter is not valid.", parsed.error.issues);
    }
    return reply.status(200).send(await deps.service.listOwners(parsed.data.includeInactive));
  });

  app.post("/empties/owners", async (request, reply) => {
    const actor = requireActor(request);
    const parsed = createOwnerSchema.safeParse(request.body);
    if (!parsed.success) throw validationError("The empties owner is not valid.", parsed.error.issues);
    return send(reply, await deps.service.createOwner(parsed.data, actor, readKey(request)));
  });

  app.patch("/empties/owners/:id", async (request, reply) => {
    const actor = requireActor(request);
    const id = readId(request);
    const parsed = renameOwnerSchema.safeParse(request.body);
    if (!parsed.success) throw validationError("The empties owner is not valid.", parsed.error.issues);
    return send(reply, await deps.service.renameOwner(id, parsed.data, actor, readKey(request)));
  });

  for (const [suffix, isActive] of [["deactivate", false], ["reactivate", true]] as const) {
    app.post(`/empties/owners/:id/${suffix}`, async (request, reply) => {
      const actor = requireActor(request);
      const id = readId(request);
      return send(reply, await deps.service.setOwnerActive(id, isActive, actor, readKey(request)));
    });
  }

  // ---------- types ----------
  app.get("/empties/types", async (request, reply) => {
    requireActor(request);
    const parsed = typeListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw validationError("The empties-type filter is not valid.", parsed.error.issues);
    }
    return reply.status(200).send(await deps.service.listTypes(parsed.data));
  });

  app.post("/empties/types", async (request, reply) => {
    const actor = requireActor(request);
    const parsed = createTypeSchema.safeParse(request.body);
    if (!parsed.success) throw validationError("The empties type is not valid.", parsed.error.issues);
    return send(reply, await deps.service.createType(parsed.data, actor, readKey(request)));
  });

  app.patch("/empties/types/:id", async (request, reply) => {
    const actor = requireActor(request);
    const id = readId(request);
    const parsed = patchTypeSchema.safeParse(request.body);
    if (!parsed.success) throw validationError("The empties type is not valid.", parsed.error.issues);
    return send(reply, await deps.service.patchType(id, parsed.data, actor, readKey(request)));
  });

  for (const [suffix, isActive] of [["deactivate", false], ["reactivate", true]] as const) {
    app.post(`/empties/types/:id/${suffix}`, async (request, reply) => {
      const actor = requireActor(request);
      const id = readId(request);
      return send(reply, await deps.service.setTypeActive(id, isActive, actor, readKey(request)));
    });
  }

  // ---------- balances ----------
  app.get("/empties/balances", async (request, reply) => {
    requireActor(request);
    const parsed = balanceListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw validationError("The empties-balance filter is not valid.", parsed.error.issues);
    }
    return reply.status(200).send(await deps.service.listBalances(parsed.data));
  });

  // ---------- movements ----------
  app.get("/empties/movements", async (request, reply) => {
    requireActor(request);
    const parsed = listMovementsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw validationError("The empties-movement filter is not valid.", parsed.error.issues);
    }
    return reply.status(200).send(await deps.service.listMovements(parsed.data));
  });

  app.post("/empties/movements", async (request, reply) => {
    const actor = requireActor(request);
    const parsed = createMovementSchema.safeParse(request.body);
    if (!parsed.success) throw validationError("The empties movement is not valid.", parsed.error.issues);
    return send(reply, await deps.service.createMovement(parsed.data, actor, readKey(request)));
  });

  app.post("/empties/movements/:id/reverse", async (request, reply) => {
    const actor = requireActor(request);
    const id = readId(request);
    const parsed = reverseMovementSchema.safeParse(request.body);
    if (!parsed.success) throw validationError("The reversal is not valid.", parsed.error.issues);
    return send(reply, await deps.service.reverseMovement(id, parsed.data, actor, readKey(request)));
  });
}
