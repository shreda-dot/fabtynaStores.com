import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireActor } from "../../auth/actor.js";
import { validationError } from "../../lib/errors.js";
import {
  accountIdParamsSchema,
  accountIdempotencyKeySchema,
  accountListQuerySchema,
  accountMovementSchema,
  accountStatementQuerySchema,
  accountTransferSchema,
  createAccountSchema,
  openingBalanceSchema,
  reconcileAccountSchema,
  renameAccountSchema,
  reversalReasonSchema,
} from "./accounts.schemas.js";
import type { createAccountsService } from "./accounts.service.js";

type AccountsService = ReturnType<typeof createAccountsService>;

function readIdempotencyKey(request: FastifyRequest): string | null {
  const raw = request.headers["idempotency-key"];
  if (raw === undefined) return null;
  const parsed = accountIdempotencyKeySchema.safeParse(raw);
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Invalid Idempotency-Key.", {
      header: "Idempotency-Key",
    });
  }
  return parsed.data;
}

function readId(request: FastifyRequest): string {
  const parsed = accountIdParamsSchema.safeParse(request.params);
  if (!parsed.success) throw validationError("Invalid account id.", parsed.error.issues);
  return parsed.data.id;
}

function send(reply: FastifyReply, result: { status: number; body: unknown; replayed: boolean }) {
  if (result.replayed) reply.header("Idempotent-Replayed", "true");
  return reply.status(result.status).send(result.body);
}

export function registerAccountsRoutes(
  app: FastifyInstance,
  deps: { service: AccountsService },
): void {
  app.get("/accounts", async (request, reply) => {
    requireActor(request);
    const parsed = accountListQuerySchema.safeParse(request.query);
    if (!parsed.success) throw validationError("The account filter is not valid.", parsed.error.issues);
    return reply.status(200).send(await deps.service.list(parsed.data.includeInactive));
  });

  app.post("/accounts", async (request, reply) => {
    const actor = requireActor(request);
    const parsed = createAccountSchema.safeParse(request.body);
    if (!parsed.success) throw validationError("The account is not valid.", parsed.error.issues);
    return send(reply, await deps.service.create(parsed.data, actor, readIdempotencyKey(request)));
  });

  app.patch("/accounts/:id", async (request, reply) => {
    const actor = requireActor(request);
    const id = readId(request);
    const parsed = renameAccountSchema.safeParse(request.body);
    if (!parsed.success) throw validationError("The account name is not valid.", parsed.error.issues);
    return send(
      reply,
      await deps.service.rename(id, parsed.data.name, actor, readIdempotencyKey(request)),
    );
  });

  for (const [suffix, isActive] of [["deactivate", false], ["reactivate", true]] as const) {
    app.post(`/accounts/:id/${suffix}`, async (request, reply) => {
      const actor = requireActor(request);
      const id = readId(request);
      return send(
        reply,
        await deps.service.setActive(id, isActive, actor, readIdempotencyKey(request)),
      );
    });
  }

  app.post("/accounts/:id/opening-balance", async (request, reply) => {
    const actor = requireActor(request);
    const id = readId(request);
    const parsed = openingBalanceSchema.safeParse(request.body);
    if (!parsed.success) throw validationError("The opening balance is not valid.", parsed.error.issues);
    return send(
      reply,
      await deps.service.openingBalance(id, parsed.data, actor, readIdempotencyKey(request)),
    );
  });

  app.post("/accounts/:id/reconcile", async (request, reply) => {
    const actor = requireActor(request);
    const id = readId(request);
    const parsed = reconcileAccountSchema.safeParse(request.body);
    if (!parsed.success) throw validationError("The reconciliation is not valid.", parsed.error.issues);
    return send(
      reply,
      await deps.service.reconcile(id, parsed.data, actor, readIdempotencyKey(request)),
    );
  });

  app.post("/accounts/:id/movements", async (request, reply) => {
    const actor = requireActor(request);
    const id = readId(request);
    const parsed = accountMovementSchema.safeParse(request.body);
    if (!parsed.success) throw validationError("The account movement is not valid.", parsed.error.issues);
    return send(
      reply,
      await deps.service.movement(id, parsed.data, actor, readIdempotencyKey(request)),
    );
  });

  app.get("/accounts/:id/statement", async (request, reply) => {
    requireActor(request);
    const id = readId(request);
    const parsed = accountStatementQuerySchema.safeParse(request.query);
    if (!parsed.success) throw validationError("The statement filter is not valid.", parsed.error.issues);
    return reply.status(200).send(await deps.service.statement(id, parsed.data));
  });

  app.post("/account-transfers", async (request, reply) => {
    const actor = requireActor(request);
    const parsed = accountTransferSchema.safeParse(request.body);
    if (!parsed.success) throw validationError("The account transfer is not valid.", parsed.error.issues);
    return send(reply, await deps.service.transfer(parsed.data, actor, readIdempotencyKey(request)));
  });

  app.post("/account-transfers/:id/reverse", async (request, reply) => {
    const actor = requireActor(request);
    const id = readId(request);
    const parsed = reversalReasonSchema.safeParse(request.body);
    if (!parsed.success) throw validationError("The transfer reversal is not valid.", parsed.error.issues);
    return send(
      reply,
      await deps.service.reverseTransfer(id, parsed.data.reason, actor, readIdempotencyKey(request)),
    );
  });

  app.post("/account-entries/:id/reverse", async (request, reply) => {
    const actor = requireActor(request);
    const id = readId(request);
    const parsed = reversalReasonSchema.safeParse(request.body);
    if (!parsed.success) throw validationError("The account-entry reversal is not valid.", parsed.error.issues);
    return send(
      reply,
      await deps.service.reverseEntry(id, parsed.data.reason, actor, readIdempotencyKey(request)),
    );
  });
}
