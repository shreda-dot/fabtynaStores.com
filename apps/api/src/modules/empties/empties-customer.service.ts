import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import type { Actor } from "../../auth/actor.js";
import { AppError, businessRuleError, validationError } from "../../lib/errors.js";
import { hashRequestBody } from "../../lib/idempotency.js";
import {
  addOneDay,
  decodeCursor,
  encodeCursor,
  lagosDayStartIso,
  likePattern,
  resolveListDateRange,
  utcTimestamp,
} from "../../lib/list-helpers.js";
import {
  counted,
  createWriteRunner,
  insertAuditLog,
  type TxContext,
  type WriteResponse,
} from "../../lib/tx.js";
import type { TxTimeouts } from "../../lib/tx-options.js";
import { assertNotInFuture } from "../sales/sales.validation.js";
import type {
  CreateCustomerMovementBody,
  ListCustomerBalancesQuery,
  ListCustomerMovementsQuery,
  ReverseCustomerMovementBody,
} from "./empties.schemas.js";

type CustomerMovementType = "TAKEN" | "RETURNED" | "KEPT" | "ADJUSTMENT";

export interface CustomerTypeRow {
  id: string;
  ownerId: string;
  ownerName: string;
  kind: "BOTTLE" | "CRATE";
  label: string;
  unitValueKobo: bigint | null;
  isActive: boolean;
}

interface CustomerMovementRow {
  id: string;
  customerId: string;
  typeId: string;
  movementType: CustomerMovementType;
  quantity: number;
  note: string | null;
  occurredAt: Date;
  createdById: string;
  emptiesMovementId: string | null;
  reversesEntryId: string | null;
  createdAt: Date;
}

interface CustomerBalanceRow {
  customerId: string;
  customerName: string;
  typeId: string;
  label: string;
  kind: "BOTTLE" | "CRATE";
  ownerId: string;
  ownerName: string;
  quantity: number;
  unitValueKobo: bigint | null;
  lastMovementAt: Date;
}

interface CustomerMovementListRow extends CustomerMovementRow {
  customerName: string;
  label: string;
  kind: "BOTTLE" | "CRATE";
  ownerId: string;
  ownerName: string;
  unitValueKobo: bigint | null;
  reversedByEntryId: string | null;
}

export interface EmptiesCustomerServiceOptions {
  prisma: PrismaClient;
  now?: () => Date;
  log?: (entry: Record<string, unknown>) => void;
  txTimeouts?: TxTimeouts;
  maxDateRangeDays?: number;
}

function safeQuantity(quantity: bigint, field: string): number {
  if (quantity < 0n || quantity > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${field} is outside the safe whole-number range.`);
  }
  return Number(quantity);
}

function customerMovementDto(
  row: CustomerMovementListRow,
  customerName = row.customerName,
) {
  return {
    id: row.id,
    customerId: row.customerId,
    customerName,
    typeId: row.typeId,
    label: row.label,
    kind: row.kind,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    movementType: row.movementType,
    quantity: row.quantity,
    valueKobo:
      row.unitValueKobo === null
        ? null
        : (BigInt(row.quantity) * row.unitValueKobo).toString(),
    note: row.note,
    occurredAt: row.occurredAt.toISOString(),
    createdById: row.createdById,
    emptiesMovementId: row.emptiesMovementId,
    reversesEntryId: row.reversesEntryId,
    reversedByEntryId: row.reversedByEntryId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function insufficientCustomerEmpties(
  customerName: string,
  type: CustomerTypeRow,
  owed: number,
  requested: number,
  context = "",
): AppError {
  const subject = context === "" ? "requested" : context;
  return new AppError(
    409,
    "BUSINESS_RULE",
    `${customerName} owes only ${owed} of '${type.label}' (${type.ownerName}); ${requested} ${subject}.`,
    {
      typeId: type.id,
      label: type.label,
      ownerName: type.ownerName,
      owed,
      requested,
    },
  );
}

function insufficientOnHand(type: CustomerTypeRow, onHand: number, needed: number): AppError {
  return new AppError(
    409,
    "BUSINESS_RULE",
    `Only ${onHand} of '${type.label}' (${type.ownerName}) is on hand; ${needed} needed to reverse this customer return.`,
    { typeId: type.id, label: type.label, ownerName: type.ownerName, onHand, needed },
  );
}

function cursorForBalance(cursor: string): { customerName: string; customerId: string; typeId: string } {
  const decoded = decodeCursor(cursor);
  const values = decoded.id.split("\u0000");
  if (values.length !== 2 || values[0] === "" || values[1] === "") {
    throw validationError("The customer-balance cursor is not valid.");
  }
  return { customerName: decoded.at, customerId: values[0]!, typeId: values[1]! };
}

export function createEmptiesCustomerService(options: EmptiesCustomerServiceOptions) {
  const { prisma } = options;
  const now = options.now ?? (() => new Date());
  const maxDateRangeDays = options.maxDateRangeDays ?? 366;
  const runner = createWriteRunner({
    prisma,
    now,
    log: options.log,
    txTimeouts: options.txTimeouts,
  });

  async function lockType(ctx: TxContext, id: string): Promise<CustomerTypeRow | null> {
    counted(ctx);
    const rows = await ctx.tx.$queryRaw<CustomerTypeRow[]>`
      SELECT t.id, t."ownerId", o.name AS "ownerName", t.kind::text AS kind,
             t.label, t."unitValueKobo", t."isActive"
        FROM empties_types t
        JOIN empties_owners o ON o.id = t."ownerId"
       WHERE t.id = ${id}
       FOR UPDATE OF t`;
    return rows[0] ?? null;
  }

  async function lockCustomerBalance(
    ctx: TxContext,
    customerId: string,
    typeId: string,
  ): Promise<number> {
    counted(ctx);
    const rows = await ctx.tx.$queryRaw<Array<{ quantity: number }>>`
      SELECT quantity
        FROM empties_customer_balances
       WHERE "customerId" = ${customerId} AND "typeId" = ${typeId}
       FOR UPDATE`;
    return rows[0]?.quantity ?? 0;
  }

  async function lockOnHand(ctx: TxContext, typeId: string): Promise<number> {
    counted(ctx);
    const rows = await ctx.tx.$queryRaw<Array<{ quantity: number }>>`
      SELECT quantity
        FROM empties_balances
       WHERE "typeId" = ${typeId}
       FOR UPDATE`;
    return rows[0]?.quantity ?? 0;
  }

  function balanceConditions(
    query: ListCustomerBalancesQuery,
    includeCursor: boolean,
  ): Prisma.Sql[] {
    const conditions: Prisma.Sql[] = [];
    if (query.customerId !== undefined) {
      conditions.push(Prisma.sql`cb."customerId" = ${query.customerId}`);
    }
    if (query.ownerId !== undefined) {
      conditions.push(Prisma.sql`t."ownerId" = ${query.ownerId}`);
    }
    if (query.typeId !== undefined) {
      conditions.push(Prisma.sql`cb."typeId" = ${query.typeId}`);
    }
    if (query.q !== undefined) {
      const pattern = likePattern(query.q);
      conditions.push(
        Prisma.sql`(c.name ILIKE ${pattern} ESCAPE '\\' OR c.phone ILIKE ${pattern} ESCAPE '\\')`,
      );
    }
    if (query.onlyOwing) conditions.push(Prisma.sql`cb.quantity > 0`);
    if (includeCursor && query.cursor !== undefined) {
      const cursor = cursorForBalance(query.cursor);
      conditions.push(Prisma.sql`(
        c.name > ${cursor.customerName}
        OR (c.name = ${cursor.customerName} AND c.id > ${cursor.customerId})
        OR (c.name = ${cursor.customerName} AND c.id = ${cursor.customerId}
            AND t.id > ${cursor.typeId})
      )`);
    }
    return conditions;
  }

  return {
    async listCustomerBalances(query: ListCustomerBalancesQuery) {
      const baseConditions = balanceConditions(query, false);
      const pageConditions = balanceConditions(query, true);
      const baseWhere =
        baseConditions.length > 0
          ? Prisma.sql`WHERE ${Prisma.join(baseConditions, " AND ")}`
          : Prisma.empty;
      const pageWhere =
        pageConditions.length > 0
          ? Prisma.sql`WHERE ${Prisma.join(pageConditions, " AND ")}`
          : Prisma.empty;

      const rows = await prisma.$queryRaw<CustomerBalanceRow[]>`
        SELECT cb."customerId", c.name AS "customerName", cb."typeId",
               t.label, t.kind::text AS kind, t."ownerId", o.name AS "ownerName",
               cb.quantity, t."unitValueKobo", MAX(m."occurredAt") AS "lastMovementAt"
          FROM empties_customer_balances cb
          JOIN customers c ON c.id = cb."customerId"
          JOIN empties_types t ON t.id = cb."typeId"
          JOIN empties_owners o ON o.id = t."ownerId"
          LEFT JOIN empties_customer_movements m
            ON m."customerId" = cb."customerId" AND m."typeId" = cb."typeId"
          ${pageWhere}
         GROUP BY cb."customerId", c.name, cb."typeId", t.label, t.kind,
                  t."ownerId", o.name, cb.quantity, t."unitValueKobo"
         ORDER BY c.name ASC, cb."customerId" ASC, cb."typeId" ASC
         LIMIT ${query.limit + 1}`;

      const totals = await prisma.$queryRaw<Array<{
        ownerId: string;
        ownerName: string;
        quantity: bigint;
        valueKobo: string | null;
      }>>`
        SELECT t."ownerId", o.name AS "ownerName",
               SUM(cb.quantity)::bigint AS quantity,
               CASE WHEN BOOL_OR(t."unitValueKobo" IS NULL) THEN NULL
                    ELSE SUM(cb.quantity::numeric * t."unitValueKobo"::numeric)::text
               END AS "valueKobo"
          FROM empties_customer_balances cb
          JOIN customers c ON c.id = cb."customerId"
          JOIN empties_types t ON t.id = cb."typeId"
          JOIN empties_owners o ON o.id = t."ownerId"
          ${baseWhere}
         GROUP BY t."ownerId", o.name
         ORDER BY o.name ASC, t."ownerId" ASC`;

      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map((row) => ({
          customerId: row.customerId,
          customerName: row.customerName,
          typeId: row.typeId,
          label: row.label,
          kind: row.kind,
          ownerId: row.ownerId,
          ownerName: row.ownerName,
          quantity: safeQuantity(BigInt(row.quantity), "customer empties balance"),
          valueKobo:
            row.unitValueKobo === null
              ? null
              : (BigInt(row.quantity) * row.unitValueKobo).toString(),
          lastMovementAt: row.lastMovementAt.toISOString(),
        })),
        totalsByOwner: totals.map((row) => ({
          ownerId: row.ownerId,
          ownerName: row.ownerName,
          quantity: safeQuantity(row.quantity, "customer empties owner total"),
          valueKobo: row.valueKobo,
        })),
        nextCursor:
          rows.length > query.limit && last !== undefined
            ? encodeCursor({
                at: last.customerName,
                id: `${last.customerId}\u0000${last.typeId}`,
              })
            : null,
      };
    },

    async listCustomerMovements(query: ListCustomerMovementsQuery) {
      const range = resolveListDateRange(query, now(), maxDateRangeDays, {
        defaultToToday: true,
        suppressDefault: false,
      });
      const conditions: Prisma.Sql[] = [];
      if (range.from !== undefined) {
        conditions.push(
          Prisma.sql`m."occurredAt" >= ${utcTimestamp(lagosDayStartIso(range.from))}`,
        );
      }
      if (range.to !== undefined) {
        conditions.push(
          Prisma.sql`m."occurredAt" < ${utcTimestamp(lagosDayStartIso(addOneDay(range.to)))}`,
        );
      }
      if (query.customerId !== undefined) {
        conditions.push(Prisma.sql`m."customerId" = ${query.customerId}`);
      }
      if (query.typeId !== undefined) {
        conditions.push(Prisma.sql`m."typeId" = ${query.typeId}`);
      }
      if (query.cursor !== undefined) {
        const cursor = decodeCursor(query.cursor);
        conditions.push(Prisma.sql`(
          m."occurredAt" < ${utcTimestamp(cursor.at)}
          OR (m."occurredAt" = ${utcTimestamp(cursor.at)} AND m.id < ${cursor.id})
        )`);
      }
      const where =
        conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
      const rows = await prisma.$queryRaw<CustomerMovementListRow[]>`
        SELECT m.id, m."customerId", c.name AS "customerName",
               m."typeId", t.label, t.kind::text AS kind, t."ownerId", o.name AS "ownerName",
               m."movementType"::text AS "movementType", m.quantity, m.note, m."occurredAt",
               m."createdById", m."emptiesMovementId", m."reversesEntryId", m."createdAt",
               reversal.id AS "reversedByEntryId",
               t."unitValueKobo"
          FROM empties_customer_movements m
          JOIN customers c ON c.id = m."customerId"
          JOIN empties_types t ON t.id = m."typeId"
          JOIN empties_owners o ON o.id = t."ownerId"
          LEFT JOIN empties_customer_movements reversal
            ON reversal."reversesEntryId" = m.id
          ${where}
         ORDER BY m."occurredAt" DESC, m.id DESC
         LIMIT ${query.limit + 1}`;
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map((row) => customerMovementDto(row)),
        nextCursor:
          rows.length > query.limit && last !== undefined
            ? encodeCursor({ at: last.occurredAt.toISOString(), id: last.id })
            : null,
        from: range.from ?? null,
        to: range.to ?? null,
      };
    },

    async createCustomerMovement(
      input: CreateCustomerMovementBody,
      actor: Actor,
      key: string | null,
    ): Promise<WriteResponse> {
      const occurredAt = input.occurredAt === undefined ? now() : new Date(input.occurredAt);
      assertNotInFuture(occurredAt, now(), "occurredAt", "The movement date");
      const route = "POST /empties/customer-movements";
      return runner.runWrite(route, { movementType: input.movementType }, (ctx) =>
        runner.withIdempotency(
          ctx,
          { actorId: actor.id, route, key, requestHash: hashRequestBody(input) },
          async () => {
            counted(ctx);
            const customers = await ctx.tx.$queryRaw<Array<{
              id: string;
              name: string;
              deletedAt: Date | null;
            }>>`
              SELECT id, name, "deletedAt"
                FROM customers
               WHERE id = ${input.customerId}
               FOR SHARE`;
            const customer = customers[0];
            if (customer === undefined) {
              throw new AppError(404, "NOT_FOUND", "Customer not found.", {
                customerId: input.customerId,
              });
            }
            if (customer.deletedAt !== null) {
              throw businessRuleError(
                `${customer.name} is inactive and cannot receive new crate movements.`,
                { customerId: customer.id },
              );
            }

            const type = await lockType(ctx, input.typeId);
            if (type === null) {
              throw validationError("That empties type does not exist.", {
                typeId: input.typeId,
              });
            }
            if (!type.isActive) {
              throw businessRuleError(
                `'${type.label}' is deactivated and cannot receive new movements.`,
                { typeId: type.id },
              );
            }

            const quantity =
              input.movementType === "TAKEN" || input.movementType === "ADJUSTMENT"
                ? input.quantity
                : -input.quantity;
            if (quantity < 0) {
              const owed = await lockCustomerBalance(ctx, customer.id, type.id);
              const requested = -quantity;
              if (owed < requested) {
                throw insufficientCustomerEmpties(customer.name, type, owed, requested);
              }
            }

            let emptiesMovementId: string | null = null;
            if (input.movementType === "RETURNED") {
              counted(ctx);
              const received = await ctx.tx.emptiesMovement.create({
                data: {
                  typeId: type.id,
                  movementType: "RECEIVED",
                  quantity: input.quantity,
                  note: input.note ?? null,
                  occurredAt,
                  createdById: actor.id,
                },
              });
              emptiesMovementId = received.id;
            }

            counted(ctx);
            const movement = await ctx.tx.emptiesCustomerMovement.create({
              data: {
                customerId: customer.id,
                typeId: type.id,
                movementType: input.movementType,
                quantity,
                note: input.note ?? null,
                occurredAt,
                createdById: actor.id,
                emptiesMovementId,
              },
            });
            const after = {
              id: movement.id,
              customerId: customer.id,
              customerName: customer.name,
              typeId: type.id,
              label: type.label,
              kind: type.kind,
              ownerId: type.ownerId,
              ownerName: type.ownerName,
              movementType: movement.movementType,
              quantity: movement.quantity,
              valueKobo:
                type.unitValueKobo === null
                  ? null
                  : (BigInt(movement.quantity) * type.unitValueKobo).toString(),
              note: movement.note,
              occurredAt: movement.occurredAt.toISOString(),
              createdById: actor.id,
              emptiesMovementId: movement.emptiesMovementId,
              reversesEntryId: movement.reversesEntryId,
              reversedByEntryId: null,
              createdAt: movement.createdAt.toISOString(),
            };
            await insertAuditLog(ctx, "EmptiesCustomerMovement", {
              actorId: actor.id,
              action: "EMPTIES_CUSTOMER_MOVEMENT_RECORDED",
              entityId: movement.id,
              afterData: after as unknown as Prisma.InputJsonValue,
              metadata: {
                idempotencyKey: key,
                actorEmail: actor.email,
                note: input.note ?? null,
                emptiesMovementId,
              },
            });
            return { status: 201, body: after };
          },
        ),
      );
    },

    async reverseCustomerMovement(
      id: string,
      input: ReverseCustomerMovementBody,
      actor: Actor,
      key: string | null,
    ): Promise<WriteResponse> {
      const route = `POST /empties/customer-movements/${id}/reverse`;
      return runner.runWrite(route, { movementId: id }, (ctx) =>
        runner.withIdempotency(
          ctx,
          { actorId: actor.id, route, key, requestHash: hashRequestBody({ id, reason: input.reason }) },
          async () => {
            counted(ctx);
            const targets = await ctx.tx.$queryRaw<CustomerMovementRow[]>`
              SELECT m.id, m."customerId", m."typeId",
                     m."movementType"::text AS "movementType", m.quantity, m.note,
                     m."occurredAt", m."createdById", m."emptiesMovementId",
                     m."reversesEntryId", m."createdAt"
                FROM empties_customer_movements m
               WHERE m.id = ${id}
               FOR UPDATE`;
            const target = targets[0];
            if (target === undefined) {
              throw new AppError(404, "NOT_FOUND", "Customer empties movement not found.", { id });
            }
            if (target.reversesEntryId !== null) {
              throw businessRuleError("A reversal cannot itself be reversed.", {
                movementId: id,
                reversesEntryId: target.reversesEntryId,
              });
            }

            counted(ctx);
            const existing = await ctx.tx.emptiesCustomerMovement.findFirst({
              where: { reversesEntryId: id },
              select: { id: true },
            });
            if (existing !== null) {
              throw businessRuleError("This customer movement has already been reversed.", {
                movementId: id,
                reversalId: existing.id,
              });
            }

            const type = await lockType(ctx, target.typeId);
            if (type === null) {
              throw validationError("That empties type no longer exists.", { typeId: target.typeId });
            }
            counted(ctx);
            const forfeits = await ctx.tx.$queryRaw<Array<{ id: string }>>`
              SELECT id FROM empties_deposit_movements
               WHERE "customerMovementId" = ${id} LIMIT 1`;
            if (forfeits.length > 0) {
              throw businessRuleError(
                "These crates were kept when a deposit was forfeited; reverse the forfeited deposit instead.",
                { movementId: id },
              );
            }
            counted(ctx);
            const customers = await ctx.tx.$queryRaw<Array<{ name: string }>>`
              SELECT name FROM customers WHERE id = ${target.customerId}`;
            const customerName = customers[0]?.name;
            if (customerName === undefined) {
              throw new AppError(404, "NOT_FOUND", "Customer not found.", {
                customerId: target.customerId,
              });
            }

            const quantity = -target.quantity;
            if (quantity < 0) {
              const owed = await lockCustomerBalance(ctx, target.customerId, target.typeId);
              const requested = -quantity;
              if (owed < requested) {
                throw insufficientCustomerEmpties(
                  customerName,
                  type,
                  owed,
                  requested,
                  "needed to reverse this crate movement",
                );
              }
            }

            let reversedEmptiesMovementId: string | null = null;
            if (target.movementType === "RETURNED") {
              if (target.emptiesMovementId === null) {
                throw new AppError(
                  500,
                  "INTERNAL",
                  "The customer return is missing its linked on-hand movement.",
                  { movementId: target.id },
                );
              }
              counted(ctx);
              const linkedRows = await ctx.tx.$queryRaw<Array<{
                id: string;
                typeId: string;
                movementType: string;
                quantity: number;
                note: string | null;
                reversesEntryId: string | null;
              }>>`
                SELECT id, "typeId", "movementType"::text AS "movementType",
                       quantity, note, "reversesEntryId"
                  FROM empties_movements
                 WHERE id = ${target.emptiesMovementId}
                 FOR UPDATE`;
              const linked = linkedRows[0];
              if (
                linked === undefined
                || linked.typeId !== target.typeId
                || linked.movementType !== "RECEIVED"
              ) {
                throw new AppError(
                  500,
                  "INTERNAL",
                  "The customer return's linked on-hand movement is invalid.",
                  { movementId: target.id, emptiesMovementId: target.emptiesMovementId },
                );
              }
              if (linked.reversesEntryId !== null) {
                throw businessRuleError(
                  "The linked on-hand movement has already been reversed.",
                  { movementId: target.id, emptiesMovementId: linked.id },
                );
              }
              counted(ctx);
              const existingEmptiesReversal = await ctx.tx.emptiesMovement.findFirst({
                where: { reversesEntryId: linked.id },
                select: { id: true },
              });
              if (existingEmptiesReversal !== null) {
                throw businessRuleError(
                  "The linked on-hand movement has already been reversed.",
                  { movementId: target.id, emptiesMovementId: linked.id },
                );
              }

              const onHand = await lockOnHand(ctx, type.id);
              const needed = linked.quantity;
              if (onHand < needed) throw insufficientOnHand(type, onHand, needed);

              counted(ctx);
              const reversal = await ctx.tx.emptiesMovement.create({
                data: {
                  typeId: linked.typeId,
                  movementType: "RECEIVED",
                  quantity: -linked.quantity,
                  note: linked.note,
                  occurredAt: now(),
                  createdById: actor.id,
                  reversesEntryId: linked.id,
                },
              });
              reversedEmptiesMovementId = reversal.id;
            }

            counted(ctx);
            const movement = await ctx.tx.emptiesCustomerMovement.create({
              data: {
                customerId: target.customerId,
                typeId: target.typeId,
                movementType: target.movementType,
                quantity,
                note: target.note,
                occurredAt: now(),
                createdById: actor.id,
                emptiesMovementId: target.emptiesMovementId,
                reversesEntryId: target.id,
              },
            });
            const after = {
              id: movement.id,
              customerId: target.customerId,
              customerName,
              typeId: type.id,
              label: type.label,
              kind: type.kind,
              ownerId: type.ownerId,
              ownerName: type.ownerName,
              movementType: movement.movementType,
              quantity: movement.quantity,
              valueKobo:
                type.unitValueKobo === null
                  ? null
                  : (BigInt(movement.quantity) * type.unitValueKobo).toString(),
              note: movement.note,
              occurredAt: movement.occurredAt.toISOString(),
              createdById: actor.id,
              emptiesMovementId: movement.emptiesMovementId,
              reversedByEntryId: null,
              createdAt: movement.createdAt.toISOString(),
              reversedEmptiesMovementId,
              reversesEntryId: movement.reversesEntryId,
            };
            await insertAuditLog(ctx, "EmptiesCustomerMovement", {
              actorId: actor.id,
              action: "EMPTIES_CUSTOMER_MOVEMENT_REVERSED",
              entityId: movement.id,
              beforeData: {
                ...after,
                id: target.id,
                quantity: target.quantity,
                reversesEntryId: target.reversesEntryId,
              } as unknown as Prisma.InputJsonValue,
              afterData: after as unknown as Prisma.InputJsonValue,
              metadata: {
                idempotencyKey: key,
                actorEmail: actor.email,
                reason: input.reason,
                reversedEmptiesMovementId,
              },
            });
            return { status: 201, body: after };
          },
        ),
      );
    },
  };
}
