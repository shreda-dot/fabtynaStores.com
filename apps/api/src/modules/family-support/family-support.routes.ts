import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { createDrawingSchema, drawingPurposeSchema, familyMemberInputSchema, idSchema, lagosDateStringSchema } from "@fabtyna/shared";
import { requireActor } from "../../auth/actor.js";
import { validationError } from "../../lib/errors.js";
import { accountIdempotencyKeySchema, reversalReasonSchema } from "../accounts/accounts.schemas.js";
import type { createAccountsService } from "../accounts/accounts.service.js";
import type { createFamilySupportService } from "./family-support.service.js";

const params = z.object({ id: idSchema }).strict();
const filterSchema = z.object({
  from: lagosDateStringSchema, to: lagosDateStringSchema,
  beneficiaryId: idSchema.optional(), purpose: drawingPurposeSchema.optional(), accountId: idSchema.optional(),
}).strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw validationError("The Family Support request is not valid.", result.error.issues);
  return result.data;
}

function key(request: FastifyRequest): string | null {
  return request.headers["idempotency-key"] === undefined ? null : parse(accountIdempotencyKeySchema, request.headers["idempotency-key"]);
}

function send(reply: FastifyReply, result: { status: number; body: unknown; replayed: boolean }) {
  if (result.replayed) reply.header("Idempotent-Replayed", "true");
  return reply.status(result.status).send(result.body);
}

export function registerFamilySupportRoutes(app: FastifyInstance, deps: {
  service: ReturnType<typeof createFamilySupportService>;
  accounts: ReturnType<typeof createAccountsService>;
}) {
  app.get("/family-members", async (request) => { requireActor(request); return deps.service.listMembers(); });
  app.post("/family-members", async (request, reply) => send(reply, await deps.service.createMember(parse(familyMemberInputSchema, request.body), requireActor(request), key(request))));
  app.patch("/family-members/:id", async (request, reply) => send(reply, await deps.service.updateMember(parse(params, request.params).id, parse(familyMemberInputSchema, request.body), requireActor(request), key(request))));
  for (const [suffix, active] of [["deactivate", false], ["reactivate", true]] as const) {
    app.post(`/family-members/:id/${suffix}`, async (request, reply) => send(reply, await deps.service.setMemberActive(parse(params, request.params).id, active, requireActor(request), key(request))));
  }
  app.get("/drawings", async (request) => { requireActor(request); return deps.service.listDrawings(parse(filterSchema, request.query)); });
  app.post("/drawings", async (request, reply) => send(reply, await deps.service.createDrawing(parse(createDrawingSchema, request.body), requireActor(request), key(request))));
  app.post("/drawings/:id/reverse", async (request, reply) => {
    const actor = requireActor(request);
    const id = parse(params, request.params).id;
    const drawing = await deps.service.findDrawingEntry(id);
    return send(reply, await deps.accounts.reverseEntry(drawing.entryId, parse(reversalReasonSchema, request.body).reason, actor, key(request)));
  });
}
