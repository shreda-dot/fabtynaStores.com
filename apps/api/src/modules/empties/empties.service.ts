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
import { createEmptiesCustomerService } from "./empties-customer.service.js";
import { createEmptiesDepositService } from "./empties-deposit.service.js";
import type {
  CreateMovementBody,
  CreateOwnerBody,
  CreateTypeBody,
  AssignProductOwnerBody,
  ListBalancesQuery,
  ListMovementsQuery,
  ListTypesQuery,
  ProductOwnerListQuery,
  PatchTypeBody,
  RenameOwnerBody,
  ReverseMovementBody,
} from "./empties.schemas.js";

/**
 * Empties tracking, phase 1 — counts only.
 *
 * `empties_balances` is derived: the migration's AFTER INSERT trigger on
 * `empties_movements` is the only writer (`trg_empties_balances_guard` rejects
 * anything else). The service therefore never writes it — it only takes a
 * `FOR UPDATE` lock on it to answer "is there enough on hand?" *before*
 * inserting, because a `23514` raised by `ck_empties_balances_nonnegative`
 * inside the trigger would otherwise surface as a generic error with no type
 * name and no count.
 *
 * Empties are counts; `unitValueKobo` is display-only and never enters a cash,
 * sales or profit report.
 */

type EmptiesKind = "BOTTLE" | "CRATE";
type EmptiesMovementType = "OPENING" | "RECEIVED" | "RETURNED_TO_OWNER" | "ADJUSTMENT";

interface OwnerRow {
  id: string;
  name: string;
  normalizedKey: string;
  isActive: boolean;
  createdAt: Date;
}

interface TypeRow {
  id: string;
  ownerId: string;
  ownerName: string;
  kind: EmptiesKind;
  label: string;
  unitValueKobo: bigint | null;
  isActive: boolean;
  createdAt: Date;
}

interface MovementRow {
  id: string;
  typeId: string;
  movementType: EmptiesMovementType;
  quantity: number;
  note: string | null;
  occurredAt: Date;
  createdById: string;
  reversesEntryId: string | null;
  customerReturnMovementId?: string | null;
  createdAt: Date;
}

interface BalanceRow {
  typeId: string;
  ownerId: string;
  ownerName: string;
  kind: EmptiesKind;
  label: string;
  unitValueKobo: bigint | null;
  quantity: number;
}

interface OverviewOwnerRow {
  ownerId: string;
  ownerName: string;
  emptyCrates: bigint;
  emptyBottles: bigint;
  emptyValueKobo: string | null;
}

interface ProductStockRow {
  productId: string;
  productName: string;
  isActive: boolean;
  sku: string | null;
  unitsPerPack: number;
  ownerId: string | null;
  ownerName: string | null;
  ownerIsActive: boolean | null;
  warehouseUnits: bigint;
  shelfUnits: bigint;
  marketUnits: bigint;
}

interface ProductOwnerRow {
  productId: string;
  productName: string;
  sku: string | null;
  unitsPerPack: number;
  ownerId: string | null;
  ownerName: string | null;
  ownerIsActive: boolean | null;
}

interface ProductOwnerLockRow extends ProductOwnerRow {}

export interface OwnerDto {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  typeCount: number;
  activeTypeCount: number;
}

export interface EmptiesTypeDto {
  id: string;
  ownerId: string;
  ownerName: string;
  kind: EmptiesKind;
  label: string;
  unitValueKobo: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface EmptiesMovementDto {
  id: string;
  typeId: string;
  movementType: EmptiesMovementType;
  quantity: number;
  note: string | null;
  occurredAt: string;
  createdById: string;
  reversesEntryId: string | null;
  customerReturnMovementId: string | null;
  createdAt: string;
}

export interface EmptiesBalanceDto {
  typeId: string;
  ownerId: string;
  ownerName: string;
  kind: EmptiesKind;
  label: string;
  unitValueKobo: string | null;
  quantity: number;
  /** `quantity * unitValueKobo`, or null when the type has no display value. */
  valueKobo: string | null;
}

export interface EmptiesBalanceTotalsDto {
  quantity: number;
  valueKobo: string;
}

export interface EmptiesBalancesDto {
  items: EmptiesBalanceDto[];
  totalsByOwner: Array<EmptiesBalanceTotalsDto & { ownerId: string; ownerName: string }>;
  totalsByKind: Array<EmptiesBalanceTotalsDto & { kind: EmptiesKind }>;
}

export interface EmptiesProductOverviewDto {
  productId: string;
  productName: string;
  isActive: boolean;
  unitsPerPack: number;
  warehouseUnits: number;
  fullCrates: number;
  looseUnits: number;
  shelfUnits: number;
  marketUnits: number;
}

export interface EmptiesOverviewOwnerDto {
  ownerId: string;
  ownerName: string;
  emptyCrates: number;
  emptyBottles: number;
  fullCrates: number;
  looseUnitsInWarehouse: number;
  bottlesOnShelfAndMarket: number;
  totalCrates: number;
  emptyValueKobo: string | null;
  products: EmptiesProductOverviewDto[];
}

export interface EmptiesStockWarningDto {
  productId: string;
  productName: string;
  unitsPerPack: number;
  warehouseUnits: number;
  shelfUnits: number;
  marketUnits: number;
  totalUnits: number;
  ownerId?: string;
  ownerName?: string;
}

export interface EmptiesOverviewDto {
  owners: EmptiesOverviewOwnerDto[];
  warnings: {
    productsWithoutBrewery: EmptiesStockWarningDto[];
    assignedCans: EmptiesStockWarningDto[];
    productsAssignedToInactiveOwner: EmptiesStockWarningDto[];
  };
}

export interface ProductOwnerDto {
  productId: string;
  productName: string;
  sku: string | null;
  unitsPerPack: number;
  ownerId: string | null;
  ownerName: string | null;
  ownerIsActive: boolean | null;
}

export interface ProductOwnerPageDto {
  items: ProductOwnerDto[];
  nextCursor: string | null;
}

export interface EmptiesServiceOptions {
  prisma: PrismaClient;
  now?: () => Date;
  log?: (entry: Record<string, unknown>) => void;
  txTimeouts?: TxTimeouts;
  maxDateRangeDays?: number;
}

const routeFor = (method: string, path: string): string => `${method} ${path}`;

function safeCount(value: bigint, field: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${field} is outside the safe whole-number range.`);
  }
  return Number(value);
}

function toOwnerDto(owner: OwnerRow, typeCount: number, activeTypeCount: number): OwnerDto {
  return {
    id: owner.id,
    name: owner.name,
    isActive: owner.isActive,
    createdAt: owner.createdAt.toISOString(),
    typeCount,
    activeTypeCount,
  };
}

function toTypeDto(type: Omit<TypeRow, "ownerName">, ownerName: string): EmptiesTypeDto {
  return {
    id: type.id,
    ownerId: type.ownerId,
    ownerName,
    kind: type.kind,
    label: type.label,
    unitValueKobo: type.unitValueKobo === null ? null : type.unitValueKobo.toString(),
    isActive: type.isActive,
    createdAt: type.createdAt.toISOString(),
  };
}

function toMovementDto(movement: MovementRow): EmptiesMovementDto {
  return {
    id: movement.id,
    typeId: movement.typeId,
    movementType: movement.movementType,
    quantity: movement.quantity,
    note: movement.note,
    occurredAt: movement.occurredAt.toISOString(),
    createdById: movement.createdById,
    reversesEntryId: movement.reversesEntryId,
    customerReturnMovementId: movement.customerReturnMovementId ?? null,
    createdAt: movement.createdAt.toISOString(),
  };
}

function normalizeName(name: string): { name: string; normalizedKey: string } {
  const normalizedName = name.trim();
  if (normalizedName.length < 1 || normalizedName.length > 60) {
    throw validationError("Empties owner names must be 1 to 60 characters.");
  }
  return { name: normalizedName, normalizedKey: normalizedName.toLowerCase() };
}

/** Friendly 409 for "you cannot take out more empties than you hold". */
function insufficientEmpties(type: TypeRow, onHand: number, requested: number): AppError {
  return new AppError(
    409,
    "BUSINESS_RULE",
    `Only ${onHand} of '${type.label}' (${type.ownerName}) on hand; ${requested} requested.`,
    { typeId: type.id, label: type.label, ownerName: type.ownerName, onHand, requested },
  );
}

export function createEmptiesService(options: EmptiesServiceOptions) {
  const { prisma } = options;
  const now = options.now ?? (() => new Date());
  const maxDateRangeDays = options.maxDateRangeDays ?? 366;
  const runner = createWriteRunner({
    prisma,
    now,
    log: options.log,
    txTimeouts: options.txTimeouts,
  });
  const customerService = createEmptiesCustomerService(options);
  const depositService = createEmptiesDepositService(options);

  // ---------- locks ----------
  async function lockOwner(ctx: TxContext, id: string): Promise<OwnerRow> {
    counted(ctx);
    const rows = await ctx.tx.$queryRaw<OwnerRow[]>`
      SELECT id, name, "normalizedKey", "isActive", "createdAt"
        FROM empties_owners
       WHERE id = ${id}
       FOR UPDATE`;
    const owner = rows[0];
    if (owner === undefined) {
      throw validationError("Empties owner not found.", { id });
    }
    return owner;
  }

  /** `FOR UPDATE OF t` locks only the type row, never the joined owner row. */
  async function lockType(ctx: TxContext, id: string): Promise<TypeRow | null> {
    counted(ctx);
    const rows = await ctx.tx.$queryRaw<TypeRow[]>`
      SELECT t.id, t."ownerId", o.name AS "ownerName", t.kind::text AS kind, t.label,
             t."unitValueKobo", t."isActive", t."createdAt"
        FROM empties_types t
        JOIN empties_owners o ON o.id = t."ownerId"
       WHERE t.id = ${id}
       FOR UPDATE OF t`;
    return rows[0] ?? null;
  }

  /** The derived balance row; a type that never moved has none and counts as zero. */
  async function lockBalance(ctx: TxContext, typeId: string): Promise<number> {
    counted(ctx);
    const rows = await ctx.tx.$queryRaw<Array<{ quantity: number }>>`
      SELECT quantity
        FROM empties_balances
       WHERE "typeId" = ${typeId}
       FOR UPDATE`;
    return rows[0]?.quantity ?? 0;
  }

  async function activeTypeCount(ctx: TxContext, ownerId: string): Promise<number> {
    counted(ctx);
    const rows = await ctx.tx.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
        FROM empties_types
       WHERE "ownerId" = ${ownerId} AND "isActive" = TRUE`;
    return Number(rows[0]?.count ?? 0n);
  }

  async function findTypeLabelConflict(
    ctx: TxContext,
    ownerId: string,
    kind: EmptiesKind,
    label: string,
    excludeId: string | null,
  ): Promise<string | null> {
    counted(ctx);
    const rows = await ctx.tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
        FROM empties_types
       WHERE "ownerId" = ${ownerId}
         AND kind = ${kind}::"EmptiesKind"
         AND lower(btrim(label)) = lower(btrim(${label}))
         AND (${excludeId}::text IS NULL OR id <> ${excludeId})`;
    return rows[0]?.id ?? null;
  }

  return {
    ...customerService,
    ...depositService,
    // ================================================================
    // Owners
    // ================================================================
    async listOwners(includeInactive: boolean): Promise<OwnerDto[]> {
      const rows = await prisma.emptiesOwner.findMany({
        where: includeInactive ? undefined : { isActive: true },
        include: { types: { select: { isActive: true } } },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
      return rows.map(({ types, ...owner }) =>
        toOwnerDto(owner, types.length, types.filter((type) => type.isActive).length),
      );
    },

    async createOwner(input: CreateOwnerBody, actor: Actor, key: string | null): Promise<WriteResponse> {
      const normalized = normalizeName(input.name);
      const route = routeFor("POST", "/empties/owners");
      return runner.runWrite(route, {}, (ctx) =>
        runner.withIdempotency(
          ctx,
          { actorId: actor.id, route, key, requestHash: hashRequestBody(input) },
          async () => {
            counted(ctx);
            const duplicate = await ctx.tx.emptiesOwner.findUnique({
              where: { normalizedKey: normalized.normalizedKey },
              select: { id: true },
            });
            if (duplicate !== null) {
              throw businessRuleError(`An empties owner named '${normalized.name}' already exists.`, {
                name: normalized.name,
              });
            }
            counted(ctx);
            const owner = await ctx.tx.emptiesOwner.create({ data: normalized });
            const after = toOwnerDto(owner, 0, 0);
            await insertAuditLog(ctx, "EmptiesOwner", {
              actorId: actor.id,
              action: "EMPTIES_OWNER_CREATED",
              entityId: owner.id,
              afterData: after as unknown as Prisma.InputJsonValue,
              metadata: { idempotencyKey: key, actorEmail: actor.email },
            });
            return { status: 201, body: after };
          },
        ),
      );
    },

    async renameOwner(
      id: string,
      input: RenameOwnerBody,
      actor: Actor,
      key: string | null,
    ): Promise<WriteResponse> {
      const normalized = normalizeName(input.name);
      const route = routeFor("PATCH", `/empties/owners/${id}`);
      return runner.runWrite(route, { ownerId: id }, (ctx) =>
        runner.withIdempotency(
          ctx,
          { actorId: actor.id, route, key, requestHash: hashRequestBody(input) },
          async () => {
            const before = await lockOwner(ctx, id);
            counted(ctx);
            const duplicate = await ctx.tx.emptiesOwner.findUnique({
              where: { normalizedKey: normalized.normalizedKey },
              select: { id: true },
            });
            if (duplicate !== null && duplicate.id !== id) {
              throw businessRuleError(`An empties owner named '${normalized.name}' already exists.`, {
                name: normalized.name,
              });
            }
            counted(ctx);
            const owner = await ctx.tx.emptiesOwner.update({ where: { id }, data: normalized });
            const after = toOwnerDto(owner, 0, 0);
            await insertAuditLog(ctx, "EmptiesOwner", {
              actorId: actor.id,
              action: "EMPTIES_OWNER_RENAMED",
              entityId: id,
              beforeData: { id, name: before.name, normalizedKey: before.normalizedKey },
              afterData: after as unknown as Prisma.InputJsonValue,
              metadata: { idempotencyKey: key, actorEmail: actor.email },
            });
            return { status: 200, body: after };
          },
        ),
      );
    },

    async setOwnerActive(
      id: string,
      isActive: boolean,
      actor: Actor,
      key: string | null,
    ): Promise<WriteResponse> {
      const suffix = isActive ? "reactivate" : "deactivate";
      const route = routeFor("POST", `/empties/owners/${id}/${suffix}`);
      const body = { isActive };
      return runner.runWrite(route, { ownerId: id }, (ctx) =>
        runner.withIdempotency(
          ctx,
          { actorId: actor.id, route, key, requestHash: hashRequestBody(body) },
          async () => {
            const before = await lockOwner(ctx, id);
            if (before.isActive === isActive) {
              throw businessRuleError(
                isActive ? "This empties owner is already active." : "This empties owner is already inactive.",
                { ownerId: id },
              );
            }
            if (!isActive) {
              const active = await activeTypeCount(ctx, id);
              if (active > 0) {
                throw businessRuleError(
                  `'${before.name}' still has ${active} active empties type(s). Deactivate them first.`,
                  { ownerId: id, activeTypeCount: active },
                );
              }
            }
            counted(ctx);
            const owner = await ctx.tx.emptiesOwner.update({ where: { id }, data: { isActive } });
            const after = toOwnerDto(owner, 0, 0);
            await insertAuditLog(ctx, "EmptiesOwner", {
              actorId: actor.id,
              action: isActive ? "EMPTIES_OWNER_REACTIVATED" : "EMPTIES_OWNER_DEACTIVATED",
              entityId: id,
              beforeData: { id, isActive: before.isActive },
              afterData: after as unknown as Prisma.InputJsonValue,
              metadata: { idempotencyKey: key, actorEmail: actor.email },
            });
            return { status: 200, body: after };
          },
        ),
      );
    },

    // ================================================================
    // Types
    // ================================================================
    async listTypes(query: ListTypesQuery): Promise<EmptiesTypeDto[]> {
      const rows = await prisma.emptiesType.findMany({
        where: {
          ...(query.includeInactive ? {} : { isActive: true }),
          ...(query.ownerId === undefined ? {} : { ownerId: query.ownerId }),
        },
        include: { owner: { select: { name: true } } },
        orderBy: [{ owner: { name: "asc" } }, { kind: "asc" }, { label: "asc" }, { id: "asc" }],
      });
      return rows.map(({ owner, ...type }) => toTypeDto(type, owner.name));
    },

    async createType(input: CreateTypeBody, actor: Actor, key: string | null): Promise<WriteResponse> {
      const route = routeFor("POST", "/empties/types");
      return runner.runWrite(route, { ownerId: input.ownerId }, (ctx) =>
        runner.withIdempotency(
          ctx,
          { actorId: actor.id, route, key, requestHash: hashRequestBody(input) },
          async () => {
            const owner = await lockOwner(ctx, input.ownerId);
            if (!owner.isActive) {
              throw businessRuleError(`'${owner.name}' is deactivated; reactivate it before adding a type.`, {
                ownerId: owner.id,
              });
            }
            const conflict = await findTypeLabelConflict(ctx, input.ownerId, input.kind, input.label, null);
            if (conflict !== null) {
              throw businessRuleError(
                `'${input.label}' already exists for ${owner.name} as a ${input.kind.toLowerCase()}.`,
                { ownerId: input.ownerId, kind: input.kind, label: input.label },
              );
            }
            counted(ctx);
            const type = await ctx.tx.emptiesType.create({
              data: {
                ownerId: input.ownerId,
                kind: input.kind,
                label: input.label.trim(),
                unitValueKobo:
                  input.unitValueKobo === undefined || input.unitValueKobo === null
                    ? null
                    : BigInt(input.unitValueKobo),
              },
            });
            const after = toTypeDto(type, owner.name);
            await insertAuditLog(ctx, "EmptiesType", {
              actorId: actor.id,
              action: "EMPTIES_TYPE_CREATED",
              entityId: type.id,
              afterData: after as unknown as Prisma.InputJsonValue,
              metadata: { idempotencyKey: key, actorEmail: actor.email },
            });
            return { status: 201, body: after };
          },
        ),
      );
    },

    async patchType(
      id: string,
      input: PatchTypeBody,
      actor: Actor,
      key: string | null,
    ): Promise<WriteResponse> {
      const route = routeFor("PATCH", `/empties/types/${id}`);
      return runner.runWrite(route, { typeId: id }, (ctx) =>
        runner.withIdempotency(
          ctx,
          { actorId: actor.id, route, key, requestHash: hashRequestBody(input) },
          async () => {
            const before = await lockType(ctx, id);
            if (before === null) {
              throw validationError("Empties type not found.", { id });
            }
            const label = input.label?.trim() ?? before.label;
            if (input.label !== undefined && label !== before.label) {
              const conflict = await findTypeLabelConflict(ctx, before.ownerId, before.kind, label, id);
              if (conflict !== null) {
                throw businessRuleError(
                  `'${label}' already exists for ${before.ownerName} as a ${before.kind.toLowerCase()}.`,
                  { typeId: id, kind: before.kind, label },
                );
              }
            }
            counted(ctx);
            const type = await ctx.tx.emptiesType.update({
              where: { id },
              data: {
                label,
                ...(input.unitValueKobo === undefined
                  ? {}
                  : { unitValueKobo: input.unitValueKobo === null ? null : BigInt(input.unitValueKobo) }),
              },
            });
            const after = toTypeDto(type, before.ownerName);
            await insertAuditLog(ctx, "EmptiesType", {
              actorId: actor.id,
              action: "EMPTIES_TYPE_UPDATED",
              entityId: id,
              beforeData: toTypeDto(before, before.ownerName) as unknown as Prisma.InputJsonValue,
              afterData: after as unknown as Prisma.InputJsonValue,
              metadata: { idempotencyKey: key, actorEmail: actor.email },
            });
            return { status: 200, body: after };
          },
        ),
      );
    },

    async setTypeActive(
      id: string,
      isActive: boolean,
      actor: Actor,
      key: string | null,
    ): Promise<WriteResponse> {
      const suffix = isActive ? "reactivate" : "deactivate";
      const route = routeFor("POST", `/empties/types/${id}/${suffix}`);
      const body = { isActive };
      return runner.runWrite(route, { typeId: id }, (ctx) =>
        runner.withIdempotency(
          ctx,
          { actorId: actor.id, route, key, requestHash: hashRequestBody(body) },
          async () => {
            const before = await lockType(ctx, id);
            if (before === null) {
              throw validationError("Empties type not found.", { id });
            }
            if (before.isActive === isActive) {
              throw businessRuleError(
                isActive ? "This empties type is already active." : "This empties type is already inactive.",
                { typeId: id },
              );
            }
            if (!isActive) {
              const onHand = await lockBalance(ctx, id);
              if (onHand !== 0) {
                throw businessRuleError(
                  `'${before.label}' still has ${onHand} on hand. Record a return or an adjustment to zero first.`,
                  { typeId: id, onHand },
                );
              }
            }
            counted(ctx);
            const type = await ctx.tx.emptiesType.update({ where: { id }, data: { isActive } });
            const after = toTypeDto(type, before.ownerName);
            await insertAuditLog(ctx, "EmptiesType", {
              actorId: actor.id,
              action: isActive ? "EMPTIES_TYPE_REACTIVATED" : "EMPTIES_TYPE_DEACTIVATED",
              entityId: id,
              beforeData: toTypeDto(before, before.ownerName) as unknown as Prisma.InputJsonValue,
              afterData: after as unknown as Prisma.InputJsonValue,
              metadata: { idempotencyKey: key, actorEmail: actor.email },
            });
            return { status: 200, body: after };
          },
        ),
      );
    },

    // ================================================================
    // Balances (derived, read-only)
    // ================================================================
    async listBalances(query: ListBalancesQuery): Promise<EmptiesBalancesDto> {
      const rows = await prisma.$queryRaw<BalanceRow[]>`
        SELECT t.id AS "typeId", t."ownerId", o.name AS "ownerName", t.kind::text AS kind, t.label,
               t."unitValueKobo", COALESCE(b.quantity, 0)::int AS quantity
          FROM empties_types t
          JOIN empties_owners o ON o.id = t."ownerId"
          LEFT JOIN empties_balances b ON b."typeId" = t.id
         ${query.includeInactive ? Prisma.empty : Prisma.sql`WHERE t."isActive" = TRUE`}
         ORDER BY o.name ASC, t.kind ASC, t.label ASC, t.id ASC`;

      const items: EmptiesBalanceDto[] = rows.map((row) => ({
        typeId: row.typeId,
        ownerId: row.ownerId,
        ownerName: row.ownerName,
        kind: row.kind,
        label: row.label,
        unitValueKobo: row.unitValueKobo === null ? null : row.unitValueKobo.toString(),
        quantity: row.quantity,
        valueKobo:
          row.unitValueKobo === null
            ? null
            : (BigInt(row.quantity) * row.unitValueKobo).toString(),
      }));

      const ownerTotals = new Map<string, EmptiesBalanceTotalsDto & { ownerId: string; ownerName: string }>();
      const kindTotals = new Map<EmptiesKind, EmptiesBalanceTotalsDto & { kind: EmptiesKind }>();
      for (const item of items) {
        const owner = ownerTotals.get(item.ownerId) ?? {
          ownerId: item.ownerId,
          ownerName: item.ownerName,
          quantity: 0,
          valueKobo: "0",
        };
        owner.quantity += item.quantity;
        owner.valueKobo = (BigInt(owner.valueKobo) + BigInt(item.valueKobo ?? "0")).toString();
        ownerTotals.set(item.ownerId, owner);

        const kind = kindTotals.get(item.kind) ?? { kind: item.kind, quantity: 0, valueKobo: "0" };
        kind.quantity += item.quantity;
        kind.valueKobo = (BigInt(kind.valueKobo) + BigInt(item.valueKobo ?? "0")).toString();
        kindTotals.set(item.kind, kind);
      }

      return {
        items,
        totalsByOwner: [...ownerTotals.values()],
        totalsByKind: [...kindTotals.values()],
      };
    },

    // ================================================================
    // Product ownership and brewery crate overview
    // ================================================================
    async getOverview(): Promise<EmptiesOverviewDto> {
      // Statement 1: empties quantities and display-only values per active owner.
      const ownerRows = await prisma.$queryRaw<OverviewOwnerRow[]>`
        SELECT o.id AS "ownerId", o.name AS "ownerName",
               COALESCE(SUM(b.quantity) FILTER (WHERE t.kind = 'CRATE'::"EmptiesKind"), 0)::bigint AS "emptyCrates",
               COALESCE(SUM(b.quantity) FILTER (WHERE t.kind = 'BOTTLE'::"EmptiesKind"), 0)::bigint AS "emptyBottles",
               CASE WHEN COUNT(t."unitValueKobo") = 0 THEN NULL
                    ELSE COALESCE(
                      SUM(b.quantity::numeric * t."unitValueKobo"::numeric)
                        FILTER (WHERE t."unitValueKobo" IS NOT NULL),
                      0
                    )::text
               END AS "emptyValueKobo"
          FROM empties_owners o
          LEFT JOIN empties_types t ON t."ownerId" = o.id
          LEFT JOIN empties_balances b ON b."typeId" = t.id
         WHERE o."isActive" = TRUE
         GROUP BY o.id, o.name
         ORDER BY o.name ASC, o.id ASC`;

      // Statement 2: one location-aggregated row per product, including inactive
      // and unassigned products so stock warnings and historical ownership remain visible.
      const stockRows = await prisma.$queryRaw<ProductStockRow[]>`
        SELECT p.id AS "productId", p.name AS "productName", p.sku,
               (p."deletedAt" IS NULL) AS "isActive", p."unitsPerPack",
               po."ownerId", o.name AS "ownerName", o."isActive" AS "ownerIsActive",
               COALESCE(SUM(sb."quantityUnits")
                 FILTER (WHERE sb.location = 'WAREHOUSE'::"StockLocation"), 0)::bigint AS "warehouseUnits",
               COALESCE(SUM(sb."quantityUnits")
                 FILTER (WHERE sb.location = 'RETAIL_SHELF'::"StockLocation"), 0)::bigint AS "shelfUnits",
               COALESCE(SUM(sb."quantityUnits")
                 FILTER (WHERE sb.location = 'MARKET'::"StockLocation"), 0)::bigint AS "marketUnits"
          FROM products p
          LEFT JOIN empties_product_owners po ON po."productId" = p.id
          LEFT JOIN empties_owners o ON o.id = po."ownerId"
          LEFT JOIN stock_balances sb ON sb."productId" = p.id
         GROUP BY p.id, p.name, p.sku, p."deletedAt", p."unitsPerPack",
                  po."ownerId", o.name, o."isActive"
         ORDER BY p.name ASC, p.id ASC`;

      const owners = new Map<string, EmptiesOverviewOwnerDto>();
      const totals = new Map<string, { fullCrates: bigint; looseUnits: bigint; shelfMarket: bigint }>();
      for (const row of ownerRows) {
        owners.set(row.ownerId, {
          ownerId: row.ownerId,
          ownerName: row.ownerName,
          emptyCrates: safeCount(row.emptyCrates, "emptyCrates"),
          emptyBottles: safeCount(row.emptyBottles, "emptyBottles"),
          fullCrates: 0,
          looseUnitsInWarehouse: 0,
          bottlesOnShelfAndMarket: 0,
          totalCrates: 0,
          emptyValueKobo: row.emptyValueKobo,
          products: [],
        });
        totals.set(row.ownerId, { fullCrates: 0n, looseUnits: 0n, shelfMarket: 0n });
      }

      const warnings: EmptiesOverviewDto["warnings"] = {
        productsWithoutBrewery: [],
        assignedCans: [],
        productsAssignedToInactiveOwner: [],
      };

      for (const row of stockRows) {
        const warehouseUnits = safeCount(row.warehouseUnits, "warehouseUnits");
        const shelfUnits = safeCount(row.shelfUnits, "shelfUnits");
        const marketUnits = safeCount(row.marketUnits, "marketUnits");
        const totalUnits = row.warehouseUnits + row.shelfUnits + row.marketUnits;
        const cans = row.unitsPerPack === 1;
        const fullCrates = cans
          ? 0n
          : row.warehouseUnits / BigInt(row.unitsPerPack);
        const looseUnits = cans
          ? row.warehouseUnits
          : row.warehouseUnits % BigInt(row.unitsPerPack);
        const stockWarning: EmptiesStockWarningDto = {
          productId: row.productId,
          productName: row.productName,
          unitsPerPack: row.unitsPerPack,
          warehouseUnits,
          shelfUnits,
          marketUnits,
          totalUnits: safeCount(totalUnits, "totalUnits"),
        };

        if (row.ownerId === null) {
          if (totalUnits > 0n) warnings.productsWithoutBrewery.push(stockWarning);
          continue;
        }

        if (cans) {
          warnings.assignedCans.push({
            ...stockWarning,
            ownerId: row.ownerId,
            ownerName: row.ownerName ?? "",
          });
        }
        if (row.ownerIsActive === false && totalUnits > 0n) {
          warnings.productsAssignedToInactiveOwner.push({
            ...stockWarning,
            ownerId: row.ownerId,
            ownerName: row.ownerName ?? "",
          });
        }

        const owner = owners.get(row.ownerId);
        if (owner === undefined) continue;

        owner.products.push({
          productId: row.productId,
          productName: row.productName,
          isActive: row.isActive,
          unitsPerPack: row.unitsPerPack,
          warehouseUnits,
          fullCrates: safeCount(fullCrates, "fullCrates"),
          looseUnits: safeCount(looseUnits, "looseUnits"),
          shelfUnits,
          marketUnits,
        });
        const ownerTotal = totals.get(row.ownerId)!;
        ownerTotal.fullCrates += fullCrates;
        ownerTotal.looseUnits += looseUnits;
        ownerTotal.shelfMarket += BigInt(shelfUnits) + BigInt(marketUnits);
      }

      for (const [ownerId, owner] of owners) {
        const ownerTotal = totals.get(ownerId)!;
        owner.fullCrates = safeCount(ownerTotal.fullCrates, "fullCrates");
        owner.looseUnitsInWarehouse = safeCount(ownerTotal.looseUnits, "looseUnitsInWarehouse");
        owner.bottlesOnShelfAndMarket = safeCount(
          ownerTotal.shelfMarket,
          "bottlesOnShelfAndMarket",
        );
        owner.totalCrates = safeCount(
          BigInt(owner.emptyCrates) + ownerTotal.fullCrates,
          "totalCrates",
        );
      }

      return { owners: [...owners.values()], warnings };
    },

    async listProductOwners(query: ProductOwnerListQuery): Promise<ProductOwnerPageDto> {
      const conditions: Prisma.Sql[] = [Prisma.sql`p."deletedAt" IS NULL`];
      if (query.q !== undefined) {
        const pattern = likePattern(query.q);
        conditions.push(
          Prisma.sql`(p.name ILIKE ${pattern} ESCAPE '\\' OR p.sku ILIKE ${pattern} ESCAPE '\\')`,
        );
      }
      if (query.assigned === "assigned") {
        conditions.push(Prisma.sql`po."ownerId" IS NOT NULL`);
      } else if (query.assigned === "unassigned") {
        conditions.push(Prisma.sql`po."ownerId" IS NULL`);
      }
      if (query.cursor !== undefined) {
        conditions.push(Prisma.sql`p.id > ${query.cursor}`);
      }
      const rows = await prisma.$queryRaw<ProductOwnerRow[]>`
        SELECT p.id AS "productId", p.name AS "productName", p.sku, p."unitsPerPack",
               po."ownerId", o.name AS "ownerName", o."isActive" AS "ownerIsActive"
          FROM products p
          LEFT JOIN empties_product_owners po ON po."productId" = p.id
          LEFT JOIN empties_owners o ON o.id = po."ownerId"
         WHERE ${Prisma.join(conditions, " AND ")}
         ORDER BY p.id ASC
         LIMIT ${query.limit + 1}`;
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page,
        nextCursor: rows.length > query.limit && last !== undefined ? last.productId : null,
      };
    },

    async assignProductOwner(
      productId: string,
      input: AssignProductOwnerBody,
      actor: Actor,
      key: string | null,
    ): Promise<WriteResponse> {
      const route = routeFor("PUT", `/empties/product-owners/${productId}`);
      return runner.runWrite(route, { productId }, (ctx) =>
        runner.withIdempotency(
          ctx,
          { actorId: actor.id, route, key, requestHash: hashRequestBody({ productId, ...input }) },
          async () => {
            counted(ctx);
            const products = await ctx.tx.$queryRaw<ProductOwnerLockRow[]>`
              SELECT p.id AS "productId", p.name AS "productName", p.sku, p."unitsPerPack",
                     po."ownerId", o.name AS "ownerName", o."isActive" AS "ownerIsActive"
                FROM products p
                LEFT JOIN empties_product_owners po ON po."productId" = p.id
                LEFT JOIN empties_owners o ON o.id = po."ownerId"
               WHERE p.id = ${productId}
               FOR UPDATE OF p`;
            const product = products[0];
            if (product === undefined) {
              throw new AppError(404, "NOT_FOUND", "Product not found.", { productId });
            }

            let targetOwner: { id: string; name: string; isActive: boolean } | null = null;
            if (input.ownerId !== null) {
              counted(ctx);
              const owners = await ctx.tx.$queryRaw<Array<{
                id: string;
                name: string;
                isActive: boolean;
              }>>`
                SELECT id, name, "isActive"
                  FROM empties_owners
                 WHERE id = ${input.ownerId}
                 FOR SHARE`;
              targetOwner = owners[0] ?? null;
              if (targetOwner === null) {
                throw new AppError(404, "NOT_FOUND", "Empties owner not found.", {
                  ownerId: input.ownerId,
                });
              }
              if (!targetOwner.isActive) {
                throw businessRuleError(
                  `'${targetOwner.name}' is deactivated; reactivate it before assigning products.`,
                  { ownerId: targetOwner.id },
                );
              }
            }

            if (product.ownerId !== input.ownerId) {
              if (input.ownerId === null) {
                counted(ctx);
                await ctx.tx.$executeRaw`
                  DELETE FROM empties_product_owners
                   WHERE "productId" = ${productId}`;
              } else {
                counted(ctx);
                await ctx.tx.$executeRaw`
                  INSERT INTO empties_product_owners ("productId", "ownerId")
                  VALUES (${productId}, ${input.ownerId})
                  ON CONFLICT ("productId") DO UPDATE
                    SET "ownerId" = EXCLUDED."ownerId",
                        "updatedAt" = CURRENT_TIMESTAMP`;
              }

              const after = {
                productId,
                productName: product.productName,
                sku: product.sku,
                unitsPerPack: product.unitsPerPack,
                ownerId: targetOwner?.id ?? null,
                ownerName: targetOwner?.name ?? null,
                ownerIsActive: targetOwner?.isActive ?? null,
              } satisfies ProductOwnerDto;
              await insertAuditLog(ctx, "Product", {
                actorId: actor.id,
                action: "EMPTIES_PRODUCT_OWNER_CHANGED",
                entityId: productId,
                beforeData: {
                  productId,
                  ownerId: product.ownerId,
                  ownerName: product.ownerName,
                },
                afterData: after as unknown as Prisma.InputJsonValue,
                metadata: { idempotencyKey: key, actorEmail: actor.email },
              });
              return { status: 200, body: after };
            }

            return {
              status: 200,
              body: {
                productId: product.productId,
                productName: product.productName,
                sku: product.sku,
                unitsPerPack: product.unitsPerPack,
                ownerId: product.ownerId,
                ownerName: product.ownerName,
                ownerIsActive: product.ownerIsActive,
              } satisfies ProductOwnerDto,
            };
          },
        ),
      );
    },

    // ================================================================
    // Movements (append-only)
    // ================================================================
    async createMovement(
      input: CreateMovementBody,
      actor: Actor,
      key: string | null,
    ): Promise<WriteResponse> {
      const occurredAt = input.occurredAt === undefined ? now() : new Date(input.occurredAt);
      assertNotInFuture(occurredAt, now(), "occurredAt", "The movement date");
      const route = routeFor("POST", "/empties/movements");
      return runner.runWrite(route, { movementType: input.movementType }, (ctx) =>
        runner.withIdempotency(
          ctx,
          { actorId: actor.id, route, key, requestHash: hashRequestBody(input) },
          async () => {
            const type = await lockType(ctx, input.typeId);
            if (type === null) {
              throw validationError("That empties type does not exist.", {
                field: "typeId",
                typeId: input.typeId,
              });
            }
            if (!type.isActive) {
              throw businessRuleError(
                `'${type.label}' is deactivated and cannot receive new movements.`,
                { typeId: type.id },
              );
            }

            // The server owns the direction for the three typed movements; an
            // ADJUSTMENT carries its own sign (the schema keeps it non-zero).
            const quantity = input.movementType === "RETURNED_TO_OWNER" ? -input.quantity : input.quantity;
            if (quantity < 0) {
              const onHand = await lockBalance(ctx, type.id);
              if (onHand + quantity < 0) {
                throw insufficientEmpties(type, onHand, -quantity);
              }
            }

            counted(ctx);
            const movement = await ctx.tx.emptiesMovement.create({
              data: {
                typeId: type.id,
                movementType: input.movementType,
                quantity,
                note: input.note ?? null,
                occurredAt,
                createdById: actor.id,
              },
            });
            const after = toMovementDto(movement);
            await insertAuditLog(ctx, "EmptiesMovement", {
              actorId: actor.id,
              action: "EMPTIES_MOVEMENT_RECORDED",
              entityId: movement.id,
              afterData: after as unknown as Prisma.InputJsonValue,
              metadata: {
                idempotencyKey: key,
                actorEmail: actor.email,
                note: input.note ?? null,
              },
            });
            return { status: 201, body: after };
          },
        ),
      );
    },

    async listMovements(query: ListMovementsQuery) {
      const range = resolveListDateRange(query, now(), maxDateRangeDays, {
        defaultToToday: true,
        suppressDefault: false,
      });
      const conditions: Prisma.Sql[] = [];
      if (range.from !== undefined) {
        conditions.push(Prisma.sql`m."occurredAt" >= ${utcTimestamp(lagosDayStartIso(range.from))}`);
      }
      if (range.to !== undefined) {
        conditions.push(
          Prisma.sql`m."occurredAt" < ${utcTimestamp(lagosDayStartIso(addOneDay(range.to)))}`,
        );
      }
      if (query.typeId !== undefined) {
        conditions.push(Prisma.sql`m."typeId" = ${query.typeId}`);
      }
      if (query.ownerId !== undefined) {
        conditions.push(
          Prisma.sql`EXISTS (SELECT 1 FROM empties_types t WHERE t.id = m."typeId" AND t."ownerId" = ${query.ownerId})`,
        );
      }
      if (query.cursor !== undefined) {
        const cursor = decodeCursor(query.cursor);
        conditions.push(
          Prisma.sql`(m."occurredAt" < ${utcTimestamp(cursor.at)}
            OR (m."occurredAt" = ${utcTimestamp(cursor.at)} AND m.id < ${cursor.id}))`,
        );
      }
      const where =
        conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
      const rows = await prisma.$queryRaw<MovementRow[]>`
        SELECT m.id, m."typeId", m."movementType"::text AS "movementType", m.quantity, m.note,
               m."occurredAt", m."createdById", m."reversesEntryId", m."createdAt",
               (SELECT cm.id
                  FROM empties_customer_movements cm
                 WHERE cm."emptiesMovementId" = m.id
                   AND cm."movementType" = 'RETURNED'
                 LIMIT 1) AS "customerReturnMovementId"
          FROM empties_movements m
          ${where}
         ORDER BY m."occurredAt" DESC, m.id DESC
         LIMIT ${query.limit + 1}`;
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      return {
        items: page.map((row) => toMovementDto(row)),
        nextCursor:
          rows.length > query.limit && last !== undefined
            ? encodeCursor({ at: last.occurredAt.toISOString(), id: last.id })
            : null,
        from: range.from ?? null,
        to: range.to ?? null,
      };
    },

    async reverseMovement(
      id: string,
      input: ReverseMovementBody,
      actor: Actor,
      key: string | null,
    ): Promise<WriteResponse> {
      const route = routeFor("POST", `/empties/movements/${id}/reverse`);
      return runner.runWrite(route, { movementId: id }, (ctx) =>
        runner.withIdempotency(
          ctx,
          { actorId: actor.id, route, key, requestHash: hashRequestBody({ id, reason: input.reason }) },
          async () => {
            // Lock the target first so two concurrent reversals cannot both pass
            // the "already reversed?" read (the partial unique index is the
            // backstop, this is the friendly answer).
            counted(ctx);
            const targets = await ctx.tx.$queryRaw<MovementRow[]>`
              SELECT m.id, m."typeId", m."movementType"::text AS "movementType", m.quantity, m.note,
                     m."occurredAt", m."createdById", m."reversesEntryId", m."createdAt"
                FROM empties_movements m
               WHERE m.id = ${id}
               FOR UPDATE`;
            const target = targets[0];
            if (target === undefined) {
              throw new AppError(404, "NOT_FOUND", "Empties movement not found.", { id });
            }
            if (target.reversesEntryId !== null) {
              throw businessRuleError("A reversal cannot itself be reversed.", {
                movementId: id,
                reversesEntryId: target.reversesEntryId,
              });
            }
            counted(ctx);
            const linkedCustomerReturns = await ctx.tx.$queryRaw<Array<{ id: string }>>`
              SELECT id
                FROM empties_customer_movements
               WHERE "emptiesMovementId" = ${id}
                 AND "movementType" = 'RETURNED'
               LIMIT 1`;
            if (linkedCustomerReturns[0] !== undefined) {
              throw businessRuleError(
                "This on-hand movement belongs to a customer return. Reverse the customer crate movement instead.",
                {
                  movementId: id,
                  customerMovementId: linkedCustomerReturns[0].id,
                },
              );
            }
            const type = await lockType(ctx, target.typeId);
            if (type === null) {
              throw validationError("That empties type no longer exists.", { typeId: target.typeId });
            }

            counted(ctx);
            const existing = await ctx.tx.emptiesMovement.findFirst({
              where: { reversesEntryId: id },
              select: { id: true },
            });
            if (existing !== null) {
              throw businessRuleError("This movement has already been reversed.", {
                movementId: id,
                reversalId: existing.id,
              });
            }

            const quantity = -target.quantity;
            if (quantity < 0) {
              const onHand = await lockBalance(ctx, target.typeId);
              if (onHand + quantity < 0) {
                throw insufficientEmpties(type, onHand, -quantity);
              }
            }

            counted(ctx);
            const movement = await ctx.tx.emptiesMovement.create({
              data: {
                typeId: target.typeId,
                movementType: target.movementType,
                quantity,
                // A reversal must match its target on every column but the
                // magnitude, so the note is copied verbatim.
                note: target.note,
                occurredAt: now(),
                createdById: actor.id,
                reversesEntryId: target.id,
              },
            });
            const after = toMovementDto(movement);
            await insertAuditLog(ctx, "EmptiesMovement", {
              actorId: actor.id,
              action: "EMPTIES_MOVEMENT_REVERSED",
              entityId: movement.id,
              beforeData: toMovementDto(target) as unknown as Prisma.InputJsonValue,
              afterData: after as unknown as Prisma.InputJsonValue,
              metadata: { idempotencyKey: key, actorEmail: actor.email, reason: input.reason },
            });
            return { status: 201, body: after };
          },
        ),
      );
    },
  };
}

export type EmptiesService = ReturnType<typeof createEmptiesService>;
