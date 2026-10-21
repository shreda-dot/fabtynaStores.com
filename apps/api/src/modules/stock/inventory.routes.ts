import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../../generated/prisma/client.js";
import { requireActor } from "../../auth/actor.js";
import { validationError } from "../../lib/errors.js";
import { inventoryQuerySchema, lowStockQuerySchema } from "./inventory.schemas.js";
import { listInventory, listLowStock } from "./inventory.queries.js";

export function registerInventoryRoutes(app: FastifyInstance, deps: {
  prisma: PrismaClient;
}): void {
  app.get("/stock", async (request, reply) => {
    requireActor(request);
    const parsed = inventoryQuerySchema.safeParse(request.query);
    if (!parsed.success) throw validationError("The stock filter is not valid.", parsed.error.issues);
    return reply.status(200).send(await listInventory(deps.prisma, parsed.data));
  });
  app.get("/stock/low", async (request, reply) => {
    requireActor(request);
    const parsed = lowStockQuerySchema.safeParse(request.query);
    if (!parsed.success) throw validationError("The low-stock filter is not valid.", parsed.error.issues);
    return reply.status(200).send(await listLowStock(deps.prisma, parsed.data));
  });
}
