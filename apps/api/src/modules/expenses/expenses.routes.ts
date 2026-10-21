import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireActor } from "../../auth/actor.js";
import { validationError } from "../../lib/errors.js";
import {
  createExpenseSchema,
  expenseIdempotencyKeySchema,
  expenseIdParamsSchema,
  expenseSummaryQuerySchema,
  expenseVoidBodySchema,
  listExpensesQuerySchema,
} from "./expenses.schemas.js";
import type { createExpensesService } from "./expenses.service.js";

type ExpensesService = ReturnType<typeof createExpensesService>;

function readIdempotencyKey(request: FastifyRequest): string | null {
  const raw = request.headers["idempotency-key"];
  if (raw === undefined) return null;
  const parsed = expenseIdempotencyKeySchema.safeParse(raw);
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Invalid Idempotency-Key.", {
      header: "Idempotency-Key",
    });
  }
  return parsed.data;
}

function readId(request: FastifyRequest): string {
  const parsed = expenseIdParamsSchema.safeParse(request.params);
  if (!parsed.success) throw validationError("Invalid expense id.", parsed.error.issues);
  return parsed.data.id;
}

function send(reply: FastifyReply, result: { status: number; body: unknown; replayed: boolean }) {
  if (result.replayed) reply.header("Idempotent-Replayed", "true");
  return reply.status(result.status).send(result.body);
}

export function registerExpensesRoutes(
  app: FastifyInstance,
  deps: { service: ExpensesService },
): void {
  app.get("/expenses", async (request, reply) => {
    requireActor(request);
    const parsed = listExpensesQuerySchema.safeParse(request.query);
    if (!parsed.success) throw validationError("The expense filter is not valid.", parsed.error.issues);
    return reply.status(200).send(await deps.service.list(parsed.data));
  });

  app.get("/expenses/summary", async (request, reply) => {
    requireActor(request);
    const parsed = expenseSummaryQuerySchema.safeParse(request.query);
    if (!parsed.success) throw validationError("The expense summary filter is not valid.", parsed.error.issues);
    return reply.status(200).send(await deps.service.summary(parsed.data));
  });

  app.post("/expenses", async (request, reply) => {
    const actor = requireActor(request);
    const parsed = createExpenseSchema.safeParse(request.body);
    if (!parsed.success) throw validationError("The expense is not valid.", parsed.error.issues);
    return send(reply, await deps.service.create(parsed.data, actor, readIdempotencyKey(request)));
  });

  app.post("/expenses/:id/void", async (request, reply) => {
    const actor = requireActor(request);
    const id = readId(request);
    const parsed = expenseVoidBodySchema.safeParse(request.body);
    if (!parsed.success) throw validationError("The expense void is not valid.", parsed.error.issues);
    return send(
      reply,
      await deps.service.void(id, parsed.data.reason, actor, readIdempotencyKey(request)),
    );
  });

  app.put("/expenses/:id", async (request, reply) => {
    const actor = requireActor(request);
    const id = readId(request);
    const parsed = createExpenseSchema.safeParse(request.body);
    if (!parsed.success) throw validationError("The expense is not valid.", parsed.error.issues);
    return send(reply, await deps.service.amend(id, parsed.data, actor, readIdempotencyKey(request)));
  });
}
