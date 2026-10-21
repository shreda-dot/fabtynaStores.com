import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireActor } from "../../auth/actor.js";
import { validationError } from "../../lib/errors.js";
import { idempotencyKeySchema } from "../sales/sales.schemas.js";
import {
  createProductSchema,
  listProductsQuerySchema,
  patchProductSchema,
  productIdParamsSchema,
} from "./products.schemas.js";
import type { createProductsService } from "./products.service.js";

type ProductsService = ReturnType<typeof createProductsService>;

function key(request: FastifyRequest): string | null {
  const raw = request.headers["idempotency-key"];
  if (raw === undefined) return null;
  const parsed = idempotencyKeySchema.safeParse(raw);
  if (!parsed.success) throw validationError("Invalid Idempotency-Key.", parsed.error.issues);
  return parsed.data;
}

function id(request: FastifyRequest): string {
  const parsed = productIdParamsSchema.safeParse(request.params);
  if (!parsed.success) throw validationError("Invalid product id.", parsed.error.issues);
  return parsed.data.id;
}

function send(reply: FastifyReply, result: { status: number; body: unknown; replayed: boolean }) {
  if (result.replayed) reply.header("Idempotent-Replayed", "true");
  return reply.status(result.status).send(result.body);
}

export function registerProductsRoutes(app: FastifyInstance, deps: {
  service: ProductsService;
}): void {
  app.get("/products", async (request, reply) => {
    requireActor(request);
    const parsed = listProductsQuerySchema.safeParse(request.query);
    if (!parsed.success) throw validationError("The product filter is not valid.", parsed.error.issues);
    return reply.status(200).send(await deps.service.list(parsed.data));
  });
  app.get("/products/:id", async (request, reply) => {
    requireActor(request);
    return reply.status(200).send(await deps.service.detail(id(request)));
  });
  app.post("/products", async (request, reply) => {
    const actor = requireActor(request);
    const parsed = createProductSchema.safeParse(request.body);
    if (!parsed.success) throw validationError("The product is not valid.", parsed.error.issues);
    return send(reply, await deps.service.create(parsed.data, actor, key(request)));
  });
  app.patch("/products/:id", async (request, reply) => {
    const actor = requireActor(request);
    const parsed = patchProductSchema.safeParse(request.body);
    if (!parsed.success) throw validationError("The product change is not valid.", parsed.error.issues);
    return send(reply, await deps.service.patch(id(request), parsed.data, actor, key(request)));
  });
  for (const [suffix, active] of [["deactivate", false], ["reactivate", true]] as const) {
    app.post(`/products/:id/${suffix}`, async (request, reply) => {
      const actor = requireActor(request);
      return send(reply, await deps.service.setActive(id(request), active, actor, key(request)));
    });
  }
}
