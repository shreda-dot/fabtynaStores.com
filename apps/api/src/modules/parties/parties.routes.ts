import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ActorResolver } from "../../auth/actor.js";
import { validationError } from "../../lib/errors.js";
import { idempotencyKeySchema } from "../sales/sales.schemas.js";
import {
  createCustomerSchema,
  createSupplierSchema,
  debtorsQuerySchema,
  listCustomersQuerySchema,
  listSuppliersQuerySchema,
  partyIdParamsSchema,
  patchCustomerSchema,
  patchSupplierSchema,
  payablesQuerySchema,
  statementQuerySchema,
} from "./parties.schemas.js";
import type { createPartiesService } from "./parties.service.js";

type PartiesService = ReturnType<typeof createPartiesService>;

function key(request: FastifyRequest): string | null {
  const raw = request.headers["idempotency-key"];
  if (raw === undefined) return null;
  const parsed = idempotencyKeySchema.safeParse(raw);
  if (!parsed.success) throw validationError("Invalid Idempotency-Key.", parsed.error.issues);
  return parsed.data;
}

function id(request: FastifyRequest): string {
  const parsed = partyIdParamsSchema.safeParse(request.params);
  if (!parsed.success) throw validationError("Invalid party id.", parsed.error.issues);
  return parsed.data.id;
}

function send(reply: FastifyReply, result: { status: number; body: unknown; replayed: boolean }) {
  if (result.replayed) reply.header("Idempotent-Replayed", "true");
  return reply.status(result.status).send(result.body);
}

export function registerPartiesRoutes(app: FastifyInstance, deps: {
  service: PartiesService;
  resolveActor: ActorResolver;
}): void {
  app.get("/customers", async (request, reply) => {
    await deps.resolveActor(request);
    const parsed = listCustomersQuerySchema.safeParse(request.query);
    if (!parsed.success) throw validationError("The customer filter is not valid.", parsed.error.issues);
    return reply.status(200).send(await deps.service.listCustomers(parsed.data));
  });
  app.post("/customers", async (request, reply) => {
    const actor = await deps.resolveActor(request);
    const parsed = createCustomerSchema.safeParse(request.body);
    if (!parsed.success) throw validationError("The customer is not valid.", parsed.error.issues);
    return send(reply, await deps.service.createCustomer(parsed.data, actor, key(request)));
  });
  app.get("/customers/:id", async (request, reply) => {
    await deps.resolveActor(request);
    return reply.status(200).send(await deps.service.customer(id(request)));
  });
  app.patch("/customers/:id", async (request, reply) => {
    const actor = await deps.resolveActor(request);
    const parsed = patchCustomerSchema.safeParse(request.body);
    if (!parsed.success) throw validationError("The customer change is not valid.", parsed.error.issues);
    return send(reply, await deps.service.patchCustomer(id(request), parsed.data, actor, key(request)));
  });
  app.get("/customers/:id/statement", async (request, reply) => {
    await deps.resolveActor(request);
    const parsed = statementQuerySchema.safeParse(request.query);
    if (!parsed.success) throw validationError("The customer statement filter is not valid.", parsed.error.issues);
    return reply.status(200).send(await deps.service.customerStatement(id(request), parsed.data));
  });
  for (const [suffix, active] of [["deactivate", false], ["reactivate", true]] as const) {
    app.post(`/customers/:id/${suffix}`, async (request, reply) => {
      const actor = await deps.resolveActor(request);
      return send(reply, await deps.service.setCustomerActive(id(request), active, actor, key(request)));
    });
  }

  app.get("/suppliers", async (request, reply) => {
    await deps.resolveActor(request);
    const parsed = listSuppliersQuerySchema.safeParse(request.query);
    if (!parsed.success) throw validationError("The supplier filter is not valid.", parsed.error.issues);
    return reply.status(200).send(await deps.service.listSuppliers(parsed.data));
  });
  app.post("/suppliers", async (request, reply) => {
    const actor = await deps.resolveActor(request);
    const parsed = createSupplierSchema.safeParse(request.body);
    if (!parsed.success) throw validationError("The supplier is not valid.", parsed.error.issues);
    return send(reply, await deps.service.createSupplier(parsed.data, actor, key(request)));
  });
  app.get("/suppliers/:id", async (request, reply) => {
    await deps.resolveActor(request);
    return reply.status(200).send(await deps.service.supplier(id(request)));
  });
  app.patch("/suppliers/:id", async (request, reply) => {
    const actor = await deps.resolveActor(request);
    const parsed = patchSupplierSchema.safeParse(request.body);
    if (!parsed.success) throw validationError("The supplier change is not valid.", parsed.error.issues);
    return send(reply, await deps.service.patchSupplier(id(request), parsed.data, actor, key(request)));
  });
  app.get("/suppliers/:id/statement", async (request, reply) => {
    await deps.resolveActor(request);
    const parsed = statementQuerySchema.safeParse(request.query);
    if (!parsed.success) throw validationError("The supplier statement filter is not valid.", parsed.error.issues);
    return reply.status(200).send(await deps.service.supplierStatement(id(request), parsed.data));
  });
  for (const [suffix, active] of [["deactivate", false], ["reactivate", true]] as const) {
    app.post(`/suppliers/:id/${suffix}`, async (request, reply) => {
      const actor = await deps.resolveActor(request);
      return send(reply, await deps.service.setSupplierActive(id(request), active, actor, key(request)));
    });
  }

  app.get("/debtors", async (request, reply) => {
    await deps.resolveActor(request);
    const parsed = debtorsQuerySchema.safeParse(request.query);
    if (!parsed.success) throw validationError("The debtor filter is not valid.", parsed.error.issues);
    return reply.status(200).send(await deps.service.debtors(parsed.data));
  });
  app.get("/payables", async (request, reply) => {
    await deps.resolveActor(request);
    const parsed = payablesQuerySchema.safeParse(request.query);
    if (!parsed.success) throw validationError("The payable filter is not valid.", parsed.error.issues);
    return reply.status(200).send(await deps.service.payables(parsed.data));
  });
}
