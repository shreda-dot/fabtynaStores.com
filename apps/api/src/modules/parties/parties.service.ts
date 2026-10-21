import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import type { Actor } from "../../auth/actor.js";
import { AppError, businessRuleError } from "../../lib/errors.js";
import { hashRequestBody } from "../../lib/idempotency.js";
import { counted, createWriteRunner, insertAuditLog } from "../../lib/tx.js";
import type { TxTimeouts } from "../../lib/tx-options.js";
import {
  getCustomerProfile,
  getCustomerStatement,
  getSupplierProfile,
  getSupplierStatement,
  listCustomers,
  listDebtors,
  listPayables,
  listSuppliers,
} from "./parties.queries.js";
import type {
  CreateCustomerBody,
  CreateSupplierBody,
  DebtorsQuery,
  ListCustomersQuery,
  ListSuppliersQuery,
  PatchCustomerBody,
  PatchSupplierBody,
  PayablesQuery,
  StatementQuery,
} from "./parties.schemas.js";

export interface PartiesServiceOptions {
  prisma: PrismaClient;
  now?: () => Date;
  log?: (entry: Record<string, unknown>) => void;
  txTimeouts?: TxTimeouts;
  maxDateRangeDays?: number;
}

function customerDto(row: {
  id: string; name: string; type: string; phone: string | null; email: string | null; address: string | null;
  notes: string | null; creditLimitKobo: bigint; deletedAt: Date | null; createdAt: Date; updatedAt: Date;
}) {
  return {
    ...row,
    creditLimitKobo: row.creditLimitKobo.toString(),
    active: row.deletedAt === null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function supplierDto(row: {
  id: string; name: string; phone: string | null; email: string | null; address: string | null;
  notes: string | null; deletedAt: Date | null; createdAt: Date; updatedAt: Date;
}) {
  return {
    ...row,
    active: row.deletedAt === null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createPartiesService(options: PartiesServiceOptions) {
  const now = options.now ?? (() => new Date());
  const maxDateRangeDays = options.maxDateRangeDays ?? 366;
  const runner = createWriteRunner({
    prisma: options.prisma,
    now,
    log: options.log,
    txTimeouts: options.txTimeouts,
  });

  return {
    listCustomers: (query: ListCustomersQuery) => listCustomers(options.prisma, query),
    listSuppliers: (query: ListSuppliersQuery) => listSuppliers(options.prisma, query),
    customer: (id: string) => getCustomerProfile(options.prisma, id, now()),
    supplier: (id: string) => getSupplierProfile(options.prisma, id, now()),
    customerStatement: (id: string, query: StatementQuery) =>
      getCustomerStatement(options.prisma, id, query, now(), maxDateRangeDays),
    supplierStatement: (id: string, query: StatementQuery) =>
      getSupplierStatement(options.prisma, id, query, now(), maxDateRangeDays),
    debtors: (query: DebtorsQuery) => listDebtors(options.prisma, query, now()),
    payables: (query: PayablesQuery) => listPayables(options.prisma, query, now()),

    async createCustomer(input: CreateCustomerBody, actor: Actor, key: string | null) {
      const route = "POST /customers";
      return runner.runWrite(route, {}, async (ctx) =>
        runner.withIdempotency(ctx, { route, key, requestHash: hashRequestBody(input) }, async () => {
          counted(ctx);
          const row = await ctx.tx.customer.create({
            data: { ...input, creditLimitKobo: BigInt(input.creditLimitKobo) },
          });
          const after = customerDto(row);
          await insertAuditLog(ctx, "Customer", {
            actorId: actor.id, action: "CUSTOMER_CREATED", entityId: row.id,
            afterData: after as Prisma.InputJsonValue, metadata: {},
          });
          return { status: 201, body: after };
        }),
      );
    },

    async patchCustomer(id: string, input: PatchCustomerBody, actor: Actor, key: string | null) {
      const route = `PATCH /customers/${id}`;
      return runner.runWrite(route, { customerId: id }, async (ctx) =>
        runner.withIdempotency(ctx, { route, key, requestHash: hashRequestBody(input) }, async () => {
          counted(ctx);
          const locked = await ctx.tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM customers WHERE id = ${id} FOR UPDATE`;
          if (!locked.length) throw new AppError(404, "NOT_FOUND", "Customer not found.", { id });
          counted(ctx);
          const before = await ctx.tx.customer.findUnique({ where: { id } });
          if (!before) throw new AppError(404, "NOT_FOUND", "Customer not found.", { id });
          const data: Prisma.CustomerUpdateInput = {};
          if (input.name !== undefined) data.name = input.name;
          if (input.type !== undefined) data.type = input.type;
          if (input.phone !== undefined) data.phone = input.phone;
          if (input.email !== undefined) data.email = input.email;
          if (input.address !== undefined) data.address = input.address;
          if (input.notes !== undefined) data.notes = input.notes;
          if (input.creditLimitKobo !== undefined) data.creditLimitKobo = BigInt(input.creditLimitKobo);
          counted(ctx);
          const row = await ctx.tx.customer.update({ where: { id }, data });
          await insertAuditLog(ctx, "Customer", {
            actorId: actor.id, action: "CUSTOMER_UPDATED", entityId: id,
            beforeData: customerDto(before) as Prisma.InputJsonValue,
            afterData: customerDto(row) as Prisma.InputJsonValue, metadata: {},
          });
          return { status: 200, body: customerDto(row) };
        }),
      );
    },

    async createSupplier(input: CreateSupplierBody, actor: Actor, key: string | null) {
      const route = "POST /suppliers";
      return runner.runWrite(route, {}, async (ctx) =>
        runner.withIdempotency(ctx, { route, key, requestHash: hashRequestBody(input) }, async () => {
          counted(ctx);
          const row = await ctx.tx.supplier.create({ data: input });
          const after = supplierDto(row);
          await insertAuditLog(ctx, "Supplier", {
            actorId: actor.id, action: "SUPPLIER_CREATED", entityId: row.id,
            afterData: after as Prisma.InputJsonValue, metadata: {},
          });
          return { status: 201, body: after };
        }),
      );
    },

    async patchSupplier(id: string, input: PatchSupplierBody, actor: Actor, key: string | null) {
      const route = `PATCH /suppliers/${id}`;
      return runner.runWrite(route, { supplierId: id }, async (ctx) =>
        runner.withIdempotency(ctx, { route, key, requestHash: hashRequestBody(input) }, async () => {
          counted(ctx);
          const locked = await ctx.tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM suppliers WHERE id = ${id} FOR UPDATE`;
          if (!locked.length) throw new AppError(404, "NOT_FOUND", "Supplier not found.", { id });
          counted(ctx);
          const before = await ctx.tx.supplier.findUnique({ where: { id } });
          if (!before) throw new AppError(404, "NOT_FOUND", "Supplier not found.", { id });
          counted(ctx);
          const row = await ctx.tx.supplier.update({ where: { id }, data: input });
          await insertAuditLog(ctx, "Supplier", {
            actorId: actor.id, action: "SUPPLIER_UPDATED", entityId: id,
            beforeData: supplierDto(before) as Prisma.InputJsonValue,
            afterData: supplierDto(row) as Prisma.InputJsonValue, metadata: {},
          });
          return { status: 200, body: supplierDto(row) };
        }),
      );
    },

    async setCustomerActive(id: string, active: boolean, actor: Actor, key: string | null) {
      const suffix = active ? "reactivate" : "deactivate";
      const route = `POST /customers/${id}/${suffix}`;
      return runner.runWrite(route, { customerId: id }, async (ctx) =>
        runner.withIdempotency(ctx, { route, key, requestHash: hashRequestBody({ active }) }, async () => {
          counted(ctx);
          const locked = await ctx.tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM customers WHERE id = ${id} FOR UPDATE`;
          if (!locked.length) throw new AppError(404, "NOT_FOUND", "Customer not found.", { id });
          counted(ctx);
          const before = await ctx.tx.customer.findUnique({ where: { id } });
          if (!before) throw new AppError(404, "NOT_FOUND", "Customer not found.", { id });
          if ((before.deletedAt === null) === active) {
            throw businessRuleError(active ? "This customer is already active." : "This customer is already inactive.", { id });
          }
          counted(ctx);
          const row = await ctx.tx.customer.update({ where: { id }, data: { deletedAt: active ? null : now() } });
          await insertAuditLog(ctx, "Customer", {
            actorId: actor.id, action: active ? "CUSTOMER_REACTIVATED" : "CUSTOMER_DEACTIVATED",
            entityId: id, beforeData: customerDto(before) as Prisma.InputJsonValue,
            afterData: customerDto(row) as Prisma.InputJsonValue, metadata: {},
          });
          return { status: 200, body: customerDto(row) };
        }),
      );
    },

    async setSupplierActive(id: string, active: boolean, actor: Actor, key: string | null) {
      const suffix = active ? "reactivate" : "deactivate";
      const route = `POST /suppliers/${id}/${suffix}`;
      return runner.runWrite(route, { supplierId: id }, async (ctx) =>
        runner.withIdempotency(ctx, { route, key, requestHash: hashRequestBody({ active }) }, async () => {
          counted(ctx);
          const locked = await ctx.tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM suppliers WHERE id = ${id} FOR UPDATE`;
          if (!locked.length) throw new AppError(404, "NOT_FOUND", "Supplier not found.", { id });
          counted(ctx);
          const before = await ctx.tx.supplier.findUnique({ where: { id } });
          if (!before) throw new AppError(404, "NOT_FOUND", "Supplier not found.", { id });
          if ((before.deletedAt === null) === active) {
            throw businessRuleError(active ? "This supplier is already active." : "This supplier is already inactive.", { id });
          }
          counted(ctx);
          const row = await ctx.tx.supplier.update({ where: { id }, data: { deletedAt: active ? null : now() } });
          await insertAuditLog(ctx, "Supplier", {
            actorId: actor.id, action: active ? "SUPPLIER_REACTIVATED" : "SUPPLIER_DEACTIVATED",
            entityId: id, beforeData: supplierDto(before) as Prisma.InputJsonValue,
            afterData: supplierDto(row) as Prisma.InputJsonValue, metadata: {},
          });
          return { status: 200, body: supplierDto(row) };
        }),
      );
    },
  };
}
