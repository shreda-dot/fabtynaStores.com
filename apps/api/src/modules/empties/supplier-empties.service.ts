import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../../generated/prisma/client.js";
import type { Actor } from "../../auth/actor.js";
import { businessRuleError, validationError } from "../../lib/errors.js";
import { hashRequestBody } from "../../lib/idempotency.js";
import { counted, createWriteRunner, insertAuditLog, type WriteResponse } from "../../lib/tx.js";
import type { TxTimeouts } from "../../lib/tx-options.js";
import type {
  OpeningSupplierEmptiesDebtBody,
  SettleSupplierEmptiesDebtBody,
  SupplierEmptiesDebtListQuery,
  SupplierEmptiesSettlementListQuery,
} from "./empties.schemas.js";

interface DebtRow {
  id: string;
  supplierId: string;
  supplierName: string;
  typeId: string;
  ownerName: string;
  kind: "CRATE" | "BOTTLE";
  typeLabel: string;
  purchaseId: string | null;
  purchaseReference: string | null;
  originalQuantity: number;
  quantity: number;
  createdAt: Date;
}

export function createSupplierEmptiesService(options: {
  prisma: PrismaClient;
  now?: () => Date;
  log?: (entry: Record<string, unknown>) => void;
  txTimeouts?: TxTimeouts;
}) {
  const runner = createWriteRunner({
    prisma: options.prisma,
    now: options.now ?? (() => new Date()),
    log: options.log,
    txTimeouts: options.txTimeouts,
  });

  return {
    async listSupplierEmptiesSettlements(query: SupplierEmptiesSettlementListQuery) {
      const rows = await options.prisma.supplierEmptiesEvent.findMany({
        where: {
          eventType: "DEBT_SETTLEMENT",
          reversesEntryId: null,
          ...(query.typeId ? { typeId: query.typeId } : {}),
          ...(query.obligationId ? { obligationId: query.obligationId } : {}),
          ...(query.supplierId ? { obligation: { supplierId: query.supplierId } } : {}),
          ...(query.cursor ? { id: { gt: query.cursor } } : {}),
        },
        include: {
          type: { select: { label: true, kind: true } },
          obligation: { select: { supplierId: true } },
          reversedBy: { select: { id: true } },
        },
        orderBy: { id: "asc" },
        take: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      return {
        items: page.map((row) => ({
          id: row.id, supplierId: row.obligation?.supplierId ?? null, typeId: row.typeId,
          kind: row.type.kind, label: row.type.label, purchaseId: row.purchaseId, obligationId: row.obligationId,
          quantity: -row.quantity, note: row.note, occurredAt: row.occurredAt.toISOString(),
          reversed: row.reversedBy.length > 0,
        })),
        nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null,
      };
    },

    async listSupplierEmptiesDebts(query: SupplierEmptiesDebtListQuery) {
      const rows = await options.prisma.$queryRaw<DebtRow[]>`
        SELECT ob.id, ob."supplierId", s.name AS "supplierName", ob."typeId",
               own.name AS "ownerName", t.kind::text AS kind, t.label AS "typeLabel",
               ob."purchaseId", p.reference AS "purchaseReference",
               COALESCE((
                 SELECT SUM(e.quantity)
                   FROM supplier_empties_events e
                  WHERE e."obligationId" = ob.id
                     AND e."reversesEntryId" IS NULL
                    AND e."eventType" IN ('OPENING_DEBT', 'PURCHASE_DEBT')
               ), 0)::int AS "originalQuantity",
               b.quantity, ob."createdAt"
          FROM supplier_empties_obligations ob
          JOIN supplier_empties_obligation_balances b ON b."obligationId" = ob.id
          JOIN suppliers s ON s.id = ob."supplierId"
          JOIN empties_types t ON t.id = ob."typeId"
          JOIN empties_owners own ON own.id = t."ownerId"
          LEFT JOIN purchases p ON p.id = ob."purchaseId"
         WHERE (${query.supplierId ?? null}::text IS NULL OR ob."supplierId" = ${query.supplierId ?? null})
           AND (${query.typeId ?? null}::text IS NULL OR ob."typeId" = ${query.typeId ?? null})
           AND (${query.includeSettled} OR b.quantity > 0)
           AND (${query.cursor ?? null}::text IS NULL OR ob.id > ${query.cursor ?? null})
         ORDER BY ob.id
         LIMIT ${query.limit + 1}`;
      const page = rows.slice(0, query.limit);
      return {
        items: page.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
        nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null,
      };
    },

    async createOpeningSupplierEmptiesDebt(
      input: OpeningSupplierEmptiesDebtBody,
      actor: Actor,
      key: string | null,
    ): Promise<WriteResponse> {
      const route = "POST /empties/supplier-debts/opening";
      return runner.runWrite(route, { supplierId: input.supplierId, typeId: input.typeId }, (ctx) =>
        runner.withIdempotency(
          ctx,
          { actorId: actor.id, route, key, requestHash: hashRequestBody(input) },
          async () => {
            counted(ctx);
            const suppliers = await ctx.tx.$queryRaw<Array<{ name: string; deletedAt: Date | null }>>`
              SELECT name, "deletedAt" FROM suppliers WHERE id = ${input.supplierId} FOR SHARE`;
            const supplier = suppliers[0];
            if (!supplier) throw validationError("Choose an existing supplier.", { field: "supplierId" });
            if (supplier.deletedAt !== null) {
              throw businessRuleError(`Reactivate '${supplier.name}' before recording an opening empties debt.`);
            }
            counted(ctx);
            const types = await ctx.tx.$queryRaw<Array<{
              label: string; isActive: boolean; ownerIsActive: boolean; capacity: number | null;
            }>>`
              SELECT t.label, t."isActive", o."isActive" AS "ownerIsActive", t.capacity
                FROM empties_types t JOIN empties_owners o ON o.id = t."ownerId"
               WHERE t.id = ${input.typeId} FOR UPDATE OF t FOR SHARE OF o`;
            const type = types[0];
            if (!type) throw validationError("Choose an existing empties type.", { field: "typeId" });
            if (!type.isActive || !type.ownerIsActive) {
              throw businessRuleError(`Reactivate '${type.label}' and its brewery before recording opening debt.`);
            }
            const capacity = type.capacity;
            if (capacity !== null && input.quantity % capacity !== 0) {
              throw businessRuleError(
                `Opening debt for '${type.label}' must be entered in whole ${capacity}-bottle crates.`,
                { typeId: input.typeId, capacity, requested: input.quantity },
              );
            }
            const obligationId = randomUUID();
            const eventId = randomUUID();
            counted(ctx);
            await ctx.tx.supplierEmptiesObligation.create({
              data: { id: obligationId, supplierId: input.supplierId, typeId: input.typeId, createdById: actor.id },
            });
            counted(ctx);
            await ctx.tx.supplierEmptiesEvent.create({
              data: {
                id: eventId, eventType: "OPENING_DEBT", typeId: input.typeId,
                obligationId, quantity: input.quantity, note: input.note, createdById: actor.id,
              },
            });
            const after = { id: obligationId, eventId, ...input, purchaseId: null };
            await insertAuditLog(ctx, "SupplierEmptiesObligation", {
              actorId: actor.id,
              action: "SUPPLIER_EMPTIES_OPENING_DEBT_RECORDED",
              entityId: obligationId,
              afterData: after,
              metadata: { idempotencyKey: key, actorEmail: actor.email },
            });
            return { status: 201, body: after };
          },
        ),
      );
    },

    async settleSupplierEmptiesDebt(
      input: SettleSupplierEmptiesDebtBody,
      actor: Actor,
      key: string | null,
    ): Promise<WriteResponse> {
      const route = "POST /empties/supplier-debts/settle";
      return runner.runWrite(route, { supplierId: input.supplierId, typeId: input.typeId }, (ctx) =>
        runner.withIdempotency(
          ctx,
          { actorId: actor.id, route, key, requestHash: hashRequestBody(input) },
          async () => {
            counted(ctx);
            const candidates = await ctx.tx.$queryRaw<Array<{ id: string; purchaseId: string | null }>>`
              SELECT ob.id, ob."purchaseId"
                FROM supplier_empties_obligations ob
                JOIN supplier_empties_obligation_balances b ON b."obligationId" = ob.id
                LEFT JOIN purchases p ON p.id = ob."purchaseId"
               WHERE ob."supplierId" = ${input.supplierId} AND ob."typeId" = ${input.typeId}
                 AND b.quantity > 0
               ORDER BY CASE WHEN ob."purchaseId" IS NULL THEN 0 ELSE 1 END,
                        COALESCE(p."purchasedAt", ob."createdAt"), ob."createdAt", ob.id`;
            const candidateIds = new Set(candidates.map((row) => row.id));
            if (input.allocations?.some((item) => !candidateIds.has(item.obligationId))) {
              throw businessRuleError("One of the selected debts is no longer available. Refresh the debts and try again.");
            }
            const selectedIds = input.allocations === undefined
              ? candidates.map((row) => row.id)
              : input.allocations.map((item) => item.obligationId);
            if (selectedIds.length === 0) {
              throw businessRuleError("There is no outstanding empties debt for this supplier and container type.");
            }
            const selected = new Set(selectedIds);
            const purchaseIds = [...new Set(candidates
              .filter((row) => selected.has(row.id) && row.purchaseId !== null)
              .map((row) => row.purchaseId!))].sort();
            if (purchaseIds.length > 0) {
              counted(ctx);
              await ctx.tx.$queryRaw`
                SELECT id FROM purchases WHERE id = ANY(${purchaseIds}::text[]) ORDER BY id FOR UPDATE`;
            }
            counted(ctx);
            await ctx.tx.$queryRaw`
              SELECT id FROM supplier_empties_obligations
               WHERE id = ANY(${selectedIds}::text[]) ORDER BY id FOR UPDATE`;
            counted(ctx);
            const balances = await ctx.tx.$queryRaw<Array<{ obligationId: string; quantity: number }>>`
              SELECT "obligationId", quantity FROM supplier_empties_obligation_balances
               WHERE "obligationId" = ANY(${selectedIds}::text[]) ORDER BY "obligationId" FOR UPDATE`;
            const balanceById = new Map(balances.map((row) => [row.obligationId, row.quantity]));
            counted(ctx);
            const types = await ctx.tx.$queryRaw<Array<{ label: string; isActive: boolean; capacity: number | null }>>`
              SELECT label, "isActive", capacity FROM empties_types WHERE id = ${input.typeId} FOR UPDATE`;
            const type = types[0];
            if (!type || !type.isActive) {
              throw businessRuleError("Reactivate this empties type before recording a return.");
            }
            if (type.capacity !== null && input.quantity % type.capacity !== 0) {
              throw businessRuleError(
                `Return '${type.label}' in whole ${type.capacity}-bottle crates.`,
                { typeId: input.typeId, capacity: type.capacity, requested: input.quantity },
              );
            }
            const capacity = type.capacity;
            if (capacity !== null
                && input.allocations?.some((allocation) => allocation.quantity % capacity !== 0)) {
              throw businessRuleError(
                `Allocate returns for '${type.label}' in whole ${capacity}-bottle crates.`,
                { typeId: input.typeId, capacity },
              );
            }
            counted(ctx);
            const inventory = await ctx.tx.$queryRaw<Array<{ quantity: number }>>`
              SELECT quantity FROM empties_balances WHERE "typeId" = ${input.typeId} FOR UPDATE`;
            const available = inventory[0]?.quantity ?? 0;
            if (input.quantity > available) {
              throw businessRuleError(
                `You have ${available} '${type.label}' empties, but tried to return ${input.quantity}. Record the missing empties first.`,
                { typeId: input.typeId, available, requested: input.quantity },
              );
            }
            const allocations: Array<{ obligationId: string; purchaseId: string | null; quantity: number }> = [];
            if (input.allocations !== undefined) {
              const byId = new Map(candidates.map((row) => [row.id, row]));
              for (const item of input.allocations) {
                if (item.quantity > (balanceById.get(item.obligationId) ?? 0)) {
                  throw businessRuleError("The return is greater than a selected debt. Refresh the debts and try again.");
                }
                allocations.push({ ...item, purchaseId: byId.get(item.obligationId)!.purchaseId });
              }
            } else {
              let remaining = input.quantity;
              for (const candidate of candidates) {
                const outstanding = balanceById.get(candidate.id) ?? 0;
                const quantity = type.capacity === null
                  ? Math.min(remaining, outstanding)
                  : Math.min(remaining, Math.floor(outstanding / type.capacity) * type.capacity);
                if (quantity > 0) allocations.push({ obligationId: candidate.id, purchaseId: candidate.purchaseId, quantity });
                remaining -= quantity;
                if (remaining === 0) break;
              }
              if (remaining > 0) {
                throw businessRuleError("The return is greater than the outstanding empties debt. Refresh the debts and try again.");
              }
            }

            const events = allocations.map((allocation) => ({ ...allocation, eventId: randomUUID(), movementId: randomUUID() }));
            for (const event of events) {
              counted(ctx);
              await ctx.tx.supplierEmptiesEvent.create({
                data: {
                  id: event.eventId, eventType: "DEBT_SETTLEMENT", typeId: input.typeId,
                  obligationId: event.obligationId, purchaseId: event.purchaseId,
                  quantity: -event.quantity, note: input.note ?? null, createdById: actor.id,
                },
              });
              counted(ctx);
              await ctx.tx.emptiesMovement.create({
                data: {
                  id: event.movementId, typeId: input.typeId, movementType: "RETURNED_TO_OWNER",
                  quantity: -event.quantity, note: input.note ?? null, createdById: actor.id,
                  supplierEmptiesEventId: event.eventId,
                },
              });
            }
            const after = { supplierId: input.supplierId, typeId: input.typeId, quantity: input.quantity, events };
            await insertAuditLog(ctx, "SupplierEmptiesSettlement", {
              actorId: actor.id,
              action: "SUPPLIER_EMPTIES_DEBT_SETTLED",
              entityId: events[0]!.eventId,
              afterData: after,
              metadata: { idempotencyKey: key, actorEmail: actor.email, note: input.note ?? null },
            });
            return { status: 201, body: after };
          },
        ),
      );
    },

    async reverseSupplierEmptiesSettlement(
      eventId: string,
      reason: string,
      actor: Actor,
      key: string | null,
    ): Promise<WriteResponse> {
      const route = `POST /empties/supplier-debts/settlements/${eventId}/reverse`;
      return runner.runWrite(route, { eventId }, (ctx) =>
        runner.withIdempotency(
          ctx,
          { actorId: actor.id, route, key, requestHash: hashRequestBody({ reason }) },
          async () => {
            counted(ctx);
            const original = await ctx.tx.supplierEmptiesEvent.findUnique({ where: { id: eventId } });
            if (!original || original.eventType !== "DEBT_SETTLEMENT" || original.reversesEntryId !== null) {
              throw validationError("Choose an original supplier empties settlement to correct.");
            }
            if (original.obligationId === null) {
              throw new Error("Supplier empties settlement is missing its obligation.");
            }
            if (original.purchaseId !== null) {
              counted(ctx);
              await ctx.tx.$queryRaw`SELECT id FROM purchases WHERE id = ${original.purchaseId} FOR UPDATE`;
            }
            counted(ctx);
            await ctx.tx.$queryRaw`SELECT id FROM supplier_empties_obligations WHERE id = ${original.obligationId} FOR UPDATE`;
            counted(ctx);
            await ctx.tx.$queryRaw`SELECT id FROM empties_types WHERE id = ${original.typeId} FOR UPDATE`;
            counted(ctx);
            const reversed = await ctx.tx.supplierEmptiesEvent.findFirst({
              where: { reversesEntryId: eventId }, select: { id: true },
            });
            if (reversed !== null) {
              throw businessRuleError("This settlement has already been corrected.");
            }
            counted(ctx);
            const movement = await ctx.tx.emptiesMovement.findFirst({
              where: { supplierEmptiesEventId: eventId, reversesEntryId: null },
            });
            if (movement === null) throw new Error("Supplier empties settlement is missing its on-hand movement.");
            const reversalId = randomUUID();
            const movementReversalId = randomUUID();
            counted(ctx);
            await ctx.tx.supplierEmptiesEvent.create({
              data: {
                id: reversalId, eventType: original.eventType, typeId: original.typeId,
                obligationId: original.obligationId, purchaseId: original.purchaseId,
                quantity: -original.quantity, reversesEntryId: original.id,
                note: reason, createdById: actor.id,
              },
            });
            counted(ctx);
            await ctx.tx.emptiesMovement.create({
              data: {
                id: movementReversalId, typeId: movement.typeId, movementType: movement.movementType,
                quantity: -movement.quantity, note: movement.note, createdById: actor.id,
                saleId: movement.saleId, supplierEmptiesEventId: movement.supplierEmptiesEventId,
                reversesEntryId: movement.id,
              },
            });
            const after = { eventId, reversalId, movementReversalId, reason };
            await insertAuditLog(ctx, "SupplierEmptiesSettlement", {
              actorId: actor.id,
              action: "SUPPLIER_EMPTIES_SETTLEMENT_REVERSED",
              entityId: eventId,
              afterData: after,
              metadata: { idempotencyKey: key, actorEmail: actor.email },
            });
            return { status: 201, body: after };
          },
        ),
      );
    },
  };
}
