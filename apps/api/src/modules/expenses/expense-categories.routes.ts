import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireActor } from "../../auth/actor.js";
import { validationError } from "../../lib/errors.js";
import {
  createExpenseCategorySchema,
  expenseCategoryIdParamsSchema,
  expenseCategoryListQuerySchema,
  expenseIdempotencyKeySchema,
  renameExpenseCategorySchema,
} from "./expense-categories.schemas.js";
import type { createExpenseCategoryService } from "./expense-categories.service.js";

type CategoryService = ReturnType<typeof createExpenseCategoryService>;

function readIdempotencyKey(request: FastifyRequest): string | null {
  const rawKey = request.headers["idempotency-key"];
  if (rawKey === undefined) return null;
  const parsed = expenseIdempotencyKeySchema.safeParse(rawKey);
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Invalid Idempotency-Key.", {
      header: "Idempotency-Key",
    });
  }
  return parsed.data;
}

function readId(request: FastifyRequest): string {
  const parsed = expenseCategoryIdParamsSchema.safeParse(request.params);
  if (!parsed.success) throw validationError("Invalid expense category id.", parsed.error.issues);
  return parsed.data.id;
}

function send(reply: FastifyReply, result: { status: number; body: unknown; replayed: boolean }) {
  if (result.replayed) reply.header("Idempotent-Replayed", "true");
  return reply.status(result.status).send(result.body);
}

export function registerExpenseCategoryRoutes(
  app: FastifyInstance,
  deps: { service: CategoryService },
): void {
  app.get("/expense-categories", async (request, reply) => {
    requireActor(request);
    const parsed = expenseCategoryListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw validationError("The expense-category filter is not valid.", parsed.error.issues);
    }
    return reply.status(200).send(await deps.service.list(parsed.data.includeInactive));
  });

  app.post("/expense-categories", async (request, reply) => {
    const actor = requireActor(request);
    const parsed = createExpenseCategorySchema.safeParse(request.body);
    if (!parsed.success) throw validationError("The category is not valid.", parsed.error.issues);
    return send(reply, await deps.service.create(parsed.data, actor, readIdempotencyKey(request)));
  });

  app.patch("/expense-categories/:id", async (request, reply) => {
    const actor = requireActor(request);
    const id = readId(request);
    const parsed = renameExpenseCategorySchema.safeParse(request.body);
    if (!parsed.success) throw validationError("The category is not valid.", parsed.error.issues);
    return send(
      reply,
      await deps.service.rename(id, parsed.data, actor, readIdempotencyKey(request)),
    );
  });

  for (const [suffix, isActive] of [["deactivate", false], ["reactivate", true]] as const) {
    app.post(`/expense-categories/:id/${suffix}`, async (request, reply) => {
      const actor = requireActor(request);
      const id = readId(request);
      return send(
        reply,
        await deps.service.setActive(id, isActive, actor, readIdempotencyKey(request)),
      );
    });
  }
}
