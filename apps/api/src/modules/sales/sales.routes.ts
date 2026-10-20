import type { FastifyInstance } from "fastify";
import type { ActorResolver } from "../../auth/actor.js";
import { validationError } from "../../lib/errors.js";
import {
  createSaleDtoSchema,
  idempotencyKeySchema,
  saleIdParamsSchema,
  zodIssues,
} from "./sales.schemas.js";
import type { SalesService } from "./sales.service.js";

export function registerSalesRoutes(
  app: FastifyInstance,
  deps: { service: SalesService; resolveActor: ActorResolver },
): void {
  app.post("/sales", async (request, reply) => {
    const actor = await deps.resolveActor(request);

    const rawKey = request.headers["idempotency-key"];
    let idempotencyKey: string | null = null;
    if (rawKey !== undefined) {
      const parsedKey = idempotencyKeySchema.safeParse(rawKey);
      if (!parsedKey.success) {
        throw validationError(parsedKey.error.issues[0]?.message ?? "Invalid Idempotency-Key.", {
          header: "Idempotency-Key",
        });
      }
      idempotencyKey = parsedKey.data;
    }

    const parsed = createSaleDtoSchema.safeParse(request.body);
    if (!parsed.success) {
      throw validationError("The sale is not valid.", zodIssues(parsed.error));
    }

    const result = await deps.service.createSale(parsed.data, actor, idempotencyKey);
    if (result.replayed) {
      reply.header("Idempotent-Replayed", "true");
    }
    return reply.status(result.status).send(result.body);
  });

  app.get("/sales/:id", async (request, reply) => {
    await deps.resolveActor(request);
    const params = saleIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw validationError("Invalid sale id.", zodIssues(params.error));
    }
    const sale = await deps.service.getSale(params.data.id);
    return reply.status(200).send(sale);
  });
}
