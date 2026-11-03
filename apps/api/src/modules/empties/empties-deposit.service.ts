import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import {
  assertAccountWillRemainNonnegative,
  buildAccountLedgerEntry,
  buildAccountReversals,
  buildAccountTransfer,
  formatNaira,
  type Account,
  type AccountLedgerEntry,
} from "@fabtyna/shared";
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
import { lockAccounts, type LockedAccount } from "../../lib/locks.js";
import {
  counted,
  createWriteRunner,
  insertAuditLog,
  type TxContext,
  type WriteResponse,
} from "../../lib/tx.js";
import type { TxTimeouts } from "../../lib/tx-options.js";
import { assertNotInFuture } from "../sales/sales.validation.js";
import { insufficientCustomerEmpties, type CustomerTypeRow } from "./empties-customer.service.js";
import type {
  CreateDepositBody,
  ListDepositBalancesQuery,
  ListDepositsQuery,
  ReverseDepositBody,
} from "./empties.schemas.js";

/**
 * Customer crate deposits.
 *
 * The money lives in ONE system holding account (`accounts."isHolding"`), so it
 * never mixes with the business's own cash. RECEIVED and REFUNDED write an
 * ADJUSTMENT entry on that account; FORFEITED is a real account transfer from
 * the holding account into a normal account, written together with a KEPT crate
 * row so the crates owed drop by the same quantity.
 *
 * Lock order (a subsequence of the one in docs/AI_CONTEXT.md):
 *   empties_deposit_balances (customer) -> empties_customer_balances
 *   -> account_balances (by accountId) -> customer row (taken by the FK check).
 * The customer row is only ever read without a lock here, so a sale that holds
 * an account and then its customer can never wait on this module.
 */

const HOLDING_ACCOUNT_NAME = "Crate deposits (held)";

type DepositMovementType = "RECEIVED" | "REFUNDED" | "FORFEITED";

interface DepositListRow {
  id: string;
  customerId: string;
  customerName: string;
  movementType: DepositMovementType;
  amountKobo: bigint;
  note: string | null;
  occurredAt: Date;
  createdById: string;
  accountEntryId: string | null;
  accountTransferId: string | null;
  customerMovementId: string | null;
  reversesEntryId: string | null;
  reversedByEntryId: string | null;
  createdAt: Date;
  crateQuantity: number | null;
  crateLabel: string | null;
}

interface DepositBalanceRow {
  customerId: string;
  customerName: string;
  amountKobo: bigint;
  lastMovementAt: Date | null;
  crates: Array<{
    typeId: string;
    label: string;
    ownerName: string;
    quantity: number;
    unitValueKobo: string | null;
  }>;
}

export interface EmptiesDepositServiceOptions {
  prisma: PrismaClient;
  now?: () => Date;
  log?: (entry: Record<string, unknown>) => void;
  txTimeouts?: TxTimeouts;
  maxDateRangeDays?: number;
}

const newId = (): string => randomUUID();

function asDomainAccount(account: LockedAccount): Account {
  const epoch = new Date(0);
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    isActive: account.isActive,
    deactivatedAt: account.isActive ? null : epoch,
    note: null,
    createdAt: epoch,
    updatedAt: epoch,
  };
}

function mapDomainError<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof RangeError) throw businessRuleError(error.message);
    throw error;
  }
}

function insufficientDeposit(
  customerName: string,
  held: bigint,
  requested: bigint,
  context = "requested",
): AppError {
  return new AppError(
    409,
    "BUSINESS_RULE",
    `${customerName} holds only ${formatNaira(held)} of deposit; ${formatNaira(requested)} ${context}.`,
    { heldKobo: held.toString(), requestedKobo: requested.toString() },
  );
}

function depositDto(row: DepositListRow) {
  return {
    id: row.id,
    customerId: row.customerId,
    customerName: row.customerName,
    movementType: row.movementType,
    amountKobo: row.amountKobo.toString(),
    note: row.note,
    occurredAt: row.occurredAt.toISOString(),
    createdById: row.createdById,
    accountEntryId: row.accountEntryId,
    accountTransferId: row.accountTransferId,
    customerMovementId: row.customerMovementId,
    crateQuantity: row.crateQuantity,
    crateLabel: row.crateLabel,
    reversesEntryId: row.reversesEntryId,
    reversedByEntryId: row.reversedByEntryId,
    createdAt: row.createdAt.toISOString(),
  };
}

function cursorForBalance(cursor: string): { customerName: string; customerId: string } {
  const decoded = decodeCursor(cursor);
  if (decoded.id === "") throw validationError("The deposit-balance cursor is not valid.");
  return { customerName: decoded.at, customerId: decoded.id };
}

export function createEmptiesDepositService(options: EmptiesDepositServiceOptions) {
  const { prisma } = options;
  const now = options.now ?? (() => new Date());
  const maxDateRangeDays = options.maxDateRangeDays ?? 366;
  const runner = createWriteRunner({
    prisma,
    now,
    log: options.log,
    txTimeouts: options.txTimeouts,
  });

  /** Creates the one holding account on first use; a concurrent create is a no-op. */
  async function ensureHoldingAccount(ctx: TxContext): Promise<string> {
    counted(ctx);
    await ctx.tx.$executeRaw`
      INSERT INTO accounts (id, name, type, "isActive", "isHolding", "updatedAt")
      VALUES (${newId()}, ${HOLDING_ACCOUNT_NAME}, 'CASH'::"AccountType", true, true, now())
      ON CONFLICT DO NOTHING`;
    counted(ctx);
    const rows = await ctx.tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM accounts WHERE "isHolding"`;
    const row = rows[0];
    if (row === undefined) {
      throw new AppError(500, "INTERNAL", "The crate-deposit holding account is missing.");
    }
    return row.id;
  }

  async function loadActiveCustomer(ctx: TxContext, customerId: string) {
    counted(ctx);
    const rows = await ctx.tx.$queryRaw<Array<{ id: string; name: string; deletedAt: Date | null }>>`
      SELECT id, name, "deletedAt" FROM customers WHERE id = ${customerId}`;
    const customer = rows[0];
    if (customer === undefined) {
      throw new AppError(404, "NOT_FOUND", "Customer not found.", { customerId });
    }
    return customer;
  }

  async function lockDepositBalance(ctx: TxContext, customerId: string): Promise<bigint> {
    counted(ctx);
    const rows = await ctx.tx.$queryRaw<Array<{ amountKobo: bigint }>>`
      SELECT "amountKobo" FROM empties_deposit_balances
       WHERE "customerId" = ${customerId}
       FOR UPDATE`;
    return rows[0]?.amountKobo ?? 0n;
  }

  async function lockCrateType(ctx: TxContext, id: string): Promise<CustomerTypeRow | null> {
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

  async function lockCrateBalance(ctx: TxContext, customerId: string, typeId: string): Promise<number> {
    counted(ctx);
    const rows = await ctx.tx.$queryRaw<Array<{ quantity: number }>>`
      SELECT quantity FROM empties_customer_balances
       WHERE "customerId" = ${customerId} AND "typeId" = ${typeId}
       FOR UPDATE`;
    return rows[0]?.quantity ?? 0;
  }

  async function createLedgerRows(ctx: TxContext, entries: readonly AccountLedgerEntry[]) {
    counted(ctx);
    await ctx.tx.accountLedgerEntry.createMany({ data: entries.map((entry) => ({ ...entry })) });
  }

  async function loadLedger(ctx: TxContext, accountIds: readonly string[]) {
    counted(ctx);
    return ctx.tx.accountLedgerEntry.findMany({
      where: { accountId: { in: [...accountIds] } },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    });
  }

  function listConditions(query: ListDepositBalancesQuery, includeCursor: boolean): Prisma.Sql[] {
    const conditions: Prisma.Sql[] = [];
    if (query.q !== undefined) {
      const pattern = likePattern(query.q);
      conditions.push(
        Prisma.sql`(c.name ILIKE ${pattern} ESCAPE '\\' OR c.phone ILIKE ${pattern} ESCAPE '\\')`,
      );
    }
    if (query.onlyHolding) conditions.push(Prisma.sql`b."amountKobo" > 0`);
    if (includeCursor && query.cursor !== undefined) {
      const cursor = cursorForBalance(query.cursor);
      conditions.push(Prisma.sql`(
        c.name > ${cursor.customerName}
        OR (c.name = ${cursor.customerName} AND c.id > ${cursor.customerId})
      )`);
    }
    return conditions;
  }

  return {
    async listDepositBalances(query: ListDepositBalancesQuery) {
      const base = listConditions(query, false);
      const page = listConditions(query, true);
      const baseWhere = base.length > 0 ? Prisma.sql`WHERE ${Prisma.join(base, " AND ")}` : Prisma.empty;
      const pageWhere = page.length > 0 ? Prisma.sql`WHERE ${Prisma.join(page, " AND ")}` : Prisma.empty;

      const rows = await prisma.$queryRaw<DepositBalanceRow[]>`
        SELECT b."customerId", c.name AS "customerName", b."amountKobo",
               (SELECT MAX(m."occurredAt") FROM empties_deposit_movements m
                 WHERE m."customerId" = b."customerId") AS "lastMovementAt",
               COALESCE((
                 SELECT json_agg(json_build_object(
                          'typeId', cb."typeId", 'label', t.label, 'ownerName', o.name,
                          'quantity', cb.quantity, 'unitValueKobo', t."unitValueKobo"::text)
                        ORDER BY o.name, t.label, cb."typeId")
                   FROM empties_customer_balances cb
                   JOIN empties_types t ON t.id = cb."typeId"
                   JOIN empties_owners o ON o.id = t."ownerId"
                  WHERE cb."customerId" = b."customerId" AND cb.quantity > 0
               ), '[]'::json) AS crates
          FROM empties_deposit_balances b
          JOIN customers c ON c.id = b."customerId"
          ${pageWhere}
         ORDER BY c.name ASC, b."customerId" ASC
         LIMIT ${query.limit + 1}`;

      const totals = await prisma.$queryRaw<Array<{ heldKobo: bigint; customers: bigint }>>`
        SELECT COALESCE(SUM(b."amountKobo"), 0)::bigint AS "heldKobo",
               COUNT(*) FILTER (WHERE b."amountKobo" > 0)::bigint AS customers
          FROM empties_deposit_balances b
          JOIN customers c ON c.id = b."customerId"
          ${baseWhere}`;
      const holding = await prisma.$queryRaw<Array<{ id: string; balanceKobo: bigint }>>`
        SELECT a.id, COALESCE(ab."balanceKobo", 0)::bigint AS "balanceKobo"
          FROM accounts a
          LEFT JOIN account_balances ab ON ab."accountId" = a.id
         WHERE a."isHolding"`;

      const pageRows = rows.slice(0, query.limit);
      const last = pageRows.at(-1);
      return {
        items: pageRows.map((row) => ({
          customerId: row.customerId,
          customerName: row.customerName,
          heldKobo: row.amountKobo.toString(),
          lastMovementAt: row.lastMovementAt?.toISOString() ?? null,
          crates: row.crates.map((crate) => ({
            typeId: crate.typeId,
            label: crate.label,
            ownerName: crate.ownerName,
            quantity: crate.quantity,
            valueKobo:
              crate.unitValueKobo === null
                ? null
                : (BigInt(crate.quantity) * BigInt(crate.unitValueKobo)).toString(),
          })),
        })),
        totals: {
          heldKobo: (totals[0]?.heldKobo ?? 0n).toString(),
          customersHolding: Number(totals[0]?.customers ?? 0n),
        },
        holdingAccount: {
          id: holding[0]?.id ?? null,
          balanceKobo: (holding[0]?.balanceKobo ?? 0n).toString(),
        },
        nextCursor:
          rows.length > query.limit && last !== undefined
            ? encodeCursor({ at: last.customerName, id: last.customerId })
            : null,
      };
    },

    async listDeposits(query: ListDepositsQuery) {
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
      if (query.customerId !== undefined) {
        conditions.push(Prisma.sql`m."customerId" = ${query.customerId}`);
      }
      if (query.cursor !== undefined) {
        const cursor = decodeCursor(query.cursor);
        conditions.push(Prisma.sql`(
          m."occurredAt" < ${utcTimestamp(cursor.at)}
          OR (m."occurredAt" = ${utcTimestamp(cursor.at)} AND m.id < ${cursor.id})
        )`);
      }
      const where = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
      const rows = await prisma.$queryRaw<DepositListRow[]>`
        SELECT m.id, m."customerId", c.name AS "customerName",
               m."movementType"::text AS "movementType", m."amountKobo", m.note, m."occurredAt",
               m."createdById", m."accountEntryId", m."accountTransferId", m."customerMovementId",
               m."reversesEntryId", m."createdAt", reversal.id AS "reversedByEntryId",
               abs(cm.quantity) AS "crateQuantity", t.label AS "crateLabel"
          FROM empties_deposit_movements m
          JOIN customers c ON c.id = m."customerId"
          LEFT JOIN empties_deposit_movements reversal ON reversal."reversesEntryId" = m.id
          LEFT JOIN empties_customer_movements cm ON cm.id = m."customerMovementId"
          LEFT JOIN empties_types t ON t.id = cm."typeId"
          ${where}
         ORDER BY m."occurredAt" DESC, m.id DESC
         LIMIT ${query.limit + 1}`;
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map(depositDto),
        nextCursor:
          rows.length > query.limit && last !== undefined
            ? encodeCursor({ at: last.occurredAt.toISOString(), id: last.id })
            : null,
        from: range.from ?? null,
        to: range.to ?? null,
      };
    },

    async createDeposit(input: CreateDepositBody, actor: Actor, key: string | null): Promise<WriteResponse> {
      const occurredAt = input.occurredAt === undefined ? now() : new Date(input.occurredAt);
      assertNotInFuture(occurredAt, now(), "occurredAt", "The deposit date");
      const amount = BigInt(input.amountKobo);
      const route = "POST /empties/deposits";
      return runner.runWrite(route, { movementType: input.movementType }, (ctx) =>
        runner.withIdempotency(
          ctx,
          { actorId: actor.id, route, key, requestHash: hashRequestBody(input) },
          async () => {
            const customer = await loadActiveCustomer(ctx, input.customerId);
            if (customer.deletedAt !== null) {
              throw businessRuleError(`${customer.name} is inactive and cannot receive new deposits.`, {
                customerId: customer.id,
              });
            }

            const held = await lockDepositBalance(ctx, customer.id);
            if (input.movementType !== "RECEIVED" && held < amount) {
              throw insufficientDeposit(customer.name, held, amount);
            }

            let type: CustomerTypeRow | null = null;
            if (input.movementType === "FORFEITED") {
              type = await lockCrateType(ctx, input.typeId as string);
              if (type === null) {
                throw validationError("That empties type does not exist.", { typeId: input.typeId });
              }
              const owed = await lockCrateBalance(ctx, customer.id, type.id);
              const quantity = input.quantity as number;
              if (owed < quantity) throw insufficientCustomerEmpties(customer.name, type, owed, quantity);
            }

            const holdingId = await ensureHoldingAccount(ctx);
            const toAccountId = input.toAccountId;
            const locked = await lockAccounts(
              ctx,
              toAccountId === undefined ? [holdingId] : [holdingId, toAccountId],
            );
            const holding = locked.get(holdingId);
            if (holding === undefined) {
              throw new AppError(500, "INTERNAL", "The crate-deposit holding account is missing.");
            }
            const holdingAccount = asDomainAccount(holding);

            let accountEntryId: string | null = null;
            let accountTransferId: string | null = null;
            let customerMovementId: string | null = null;
            let signedAmount = amount;

            if (input.movementType === "RECEIVED") {
              const entry = buildAccountLedgerEntry(
                {
                  accountId: holding.id,
                  type: "ADJUSTMENT",
                  amountKobo: amount,
                  note: `Crate deposit received - ${customer.name}`,
                  occurredAt,
                },
                newId,
              );
              await createLedgerRows(ctx, [entry]);
              accountEntryId = entry.id;
            } else if (input.movementType === "REFUNDED") {
              signedAmount = -amount;
              mapDomainError(() =>
                assertAccountWillRemainNonnegative(holdingAccount, holding.balanceKobo, -amount),
              );
              const entry = buildAccountLedgerEntry(
                {
                  accountId: holding.id,
                  type: "ADJUSTMENT",
                  amountKobo: -amount,
                  note: `Crate deposit refunded - ${customer.name}`,
                  occurredAt,
                },
                newId,
              );
              await createLedgerRows(ctx, [entry]);
              accountEntryId = entry.id;
            } else {
              signedAmount = -amount;
              const to = toAccountId === undefined ? undefined : locked.get(toAccountId);
              if (to === undefined) {
                throw new AppError(404, "NOT_FOUND", "The receiving account was not found.", {
                  accountId: toAccountId,
                });
              }
              if (to.id === holding.id) {
                throw businessRuleError("Choose a normal account to receive the forfeited deposit.");
              }
              const built = mapDomainError(() =>
                buildAccountTransfer(
                  {
                    fromAccountId: holding.id,
                    toAccountId: to.id,
                    amountKobo: amount,
                    note: `Crate deposit forfeited - ${customer.name}`,
                    occurredAt,
                  },
                  [holdingAccount, asDomainAccount(to)],
                  holding.balanceKobo,
                  newId,
                ),
              );
              counted(ctx);
              await ctx.tx.accountTransfer.create({ data: { ...built.transfer } });
              await createLedgerRows(ctx, built.entries);
              accountTransferId = built.transfer.id;

              counted(ctx);
              const kept = await ctx.tx.emptiesCustomerMovement.create({
                data: {
                  customerId: customer.id,
                  typeId: (type as CustomerTypeRow).id,
                  movementType: "KEPT",
                  quantity: -(input.quantity as number),
                  note: input.note ?? null,
                  occurredAt,
                  createdById: actor.id,
                },
              });
              customerMovementId = kept.id;
            }

            counted(ctx);
            const movement = await ctx.tx.emptiesDepositMovement.create({
              data: {
                customerId: customer.id,
                movementType: input.movementType,
                amountKobo: signedAmount,
                accountEntryId,
                accountTransferId,
                customerMovementId,
                note: input.note ?? null,
                occurredAt,
                createdById: actor.id,
              },
            });
            const after = {
              id: movement.id,
              customerId: customer.id,
              customerName: customer.name,
              movementType: movement.movementType,
              amountKobo: movement.amountKobo.toString(),
              note: movement.note,
              occurredAt: movement.occurredAt.toISOString(),
              createdById: actor.id,
              accountEntryId,
              accountTransferId,
              customerMovementId,
              crateQuantity: input.movementType === "FORFEITED" ? (input.quantity ?? null) : null,
              crateLabel: type?.label ?? null,
              reversesEntryId: null,
              reversedByEntryId: null,
              createdAt: movement.createdAt.toISOString(),
              heldAfterKobo: (held + signedAmount).toString(),
            };
            await insertAuditLog(ctx, "EmptiesDepositMovement", {
              actorId: actor.id,
              action: "EMPTIES_DEPOSIT_RECORDED",
              entityId: movement.id,
              afterData: after as unknown as Prisma.InputJsonValue,
              metadata: {
                idempotencyKey: key,
                actorEmail: actor.email,
                note: input.note ?? null,
                toAccountId: toAccountId ?? null,
              },
            });
            return { status: 201, body: after };
          },
        ),
      );
    },

    async reverseDeposit(
      id: string,
      input: ReverseDepositBody,
      actor: Actor,
      key: string | null,
    ): Promise<WriteResponse> {
      const route = `POST /empties/deposits/${id}/reverse`;
      return runner.runWrite(route, { depositId: id }, (ctx) =>
        runner.withIdempotency(
          ctx,
          { actorId: actor.id, route, key, requestHash: hashRequestBody({ id, reason: input.reason }) },
          async () => {
            counted(ctx);
            const targets = await ctx.tx.$queryRaw<Array<{
              id: string;
              customerId: string;
              movementType: DepositMovementType;
              amountKobo: bigint;
              accountEntryId: string | null;
              accountTransferId: string | null;
              customerMovementId: string | null;
              note: string | null;
              reversesEntryId: string | null;
            }>>`
              SELECT id, "customerId", "movementType"::text AS "movementType", "amountKobo",
                     "accountEntryId", "accountTransferId", "customerMovementId", note,
                     "reversesEntryId"
                FROM empties_deposit_movements
               WHERE id = ${id}
               FOR UPDATE`;
            const target = targets[0];
            if (target === undefined) {
              throw new AppError(404, "NOT_FOUND", "Deposit movement not found.", { id });
            }
            if (target.reversesEntryId !== null) {
              throw businessRuleError("A reversal cannot itself be reversed.", { depositId: id });
            }
            counted(ctx);
            const existing = await ctx.tx.emptiesDepositMovement.findFirst({
              where: { reversesEntryId: id },
              select: { id: true },
            });
            if (existing !== null) {
              throw businessRuleError("This deposit movement has already been reversed.", {
                depositId: id,
                reversalId: existing.id,
              });
            }

            const customer = await loadActiveCustomer(ctx, target.customerId);
            const held = await lockDepositBalance(ctx, target.customerId);
            const reversedAmount = -target.amountKobo;
            if (held + reversedAmount < 0n) {
              throw insufficientDeposit(
                customer.name,
                held,
                -reversedAmount,
                "needed to reverse this deposit",
              );
            }

            let crateType: CustomerTypeRow | null = null;
            let crateTarget: {
              typeId: string;
              customerId: string;
              note: string | null;
              quantity: number;
            } | null = null;
            if (target.movementType === "FORFEITED") {
              counted(ctx);
              const row = await ctx.tx.emptiesCustomerMovement.findUnique({
                where: { id: target.customerMovementId as string },
              });
              if (row === null) {
                throw new AppError(500, "INTERNAL", "The forfeit is missing its crate movement.", {
                  depositId: id,
                });
              }
              crateTarget = row;
              crateType = await lockCrateType(ctx, row.typeId);
              await lockCrateBalance(ctx, row.customerId, row.typeId);
            }

            const holdingId = await ensureHoldingAccount(ctx);
            counted(ctx);
            const entryTargets =
              target.movementType === "FORFEITED"
                ? await ctx.tx.accountLedgerEntry.findMany({
                    where: { accountTransferId: target.accountTransferId, reversesEntryId: null },
                    orderBy: [{ accountId: "asc" }, { id: "asc" }],
                  })
                : await ctx.tx.accountLedgerEntry.findMany({
                    where: { id: target.accountEntryId as string },
                  });
            const expectedEntries = target.movementType === "FORFEITED" ? 2 : 1;
            if (entryTargets.length !== expectedEntries) {
              throw businessRuleError("This deposit no longer has its live account entries.", {
                depositId: id,
              });
            }

            const accountIds = [...new Set([holdingId, ...entryTargets.map((entry) => entry.accountId)])];
            const locked = await lockAccounts(ctx, accountIds);
            const accounts = [...locked.values()].map(asDomainAccount);
            const ledger = await loadLedger(ctx, accountIds);
            const reversals = mapDomainError(() =>
              buildAccountReversals(entryTargets, ledger, accounts, now(), newId, input.reason.trim()),
            );
            await createLedgerRows(ctx, reversals);

            let customerMovementId: string | null = null;
            if (crateTarget !== null) {
              counted(ctx);
              const reversedCrate = await ctx.tx.emptiesCustomerMovement.create({
                data: {
                  customerId: crateTarget.customerId,
                  typeId: crateTarget.typeId,
                  movementType: "KEPT",
                  quantity: -crateTarget.quantity,
                  note: crateTarget.note,
                  occurredAt: now(),
                  createdById: actor.id,
                  reversesEntryId: target.customerMovementId,
                },
              });
              customerMovementId = reversedCrate.id;
            }

            const accountEntryId =
              target.movementType === "FORFEITED" ? null : (reversals[0]?.id ?? null);
            counted(ctx);
            const movement = await ctx.tx.emptiesDepositMovement.create({
              data: {
                customerId: target.customerId,
                movementType: target.movementType,
                amountKobo: reversedAmount,
                accountEntryId,
                accountTransferId: target.accountTransferId,
                customerMovementId,
                note: target.note,
                occurredAt: now(),
                createdById: actor.id,
                reversesEntryId: target.id,
              },
            });
            const after = {
              id: movement.id,
              customerId: target.customerId,
              customerName: customer.name,
              movementType: movement.movementType,
              amountKobo: movement.amountKobo.toString(),
              note: movement.note,
              occurredAt: movement.occurredAt.toISOString(),
              createdById: actor.id,
              accountEntryId,
              accountTransferId: target.accountTransferId,
              customerMovementId,
              crateQuantity: crateTarget === null ? null : Math.abs(crateTarget.quantity),
              crateLabel: crateType?.label ?? null,
              reversesEntryId: target.id,
              reversedByEntryId: null,
              createdAt: movement.createdAt.toISOString(),
              heldAfterKobo: (held + reversedAmount).toString(),
            };
            await insertAuditLog(ctx, "EmptiesDepositMovement", {
              actorId: actor.id,
              action: "EMPTIES_DEPOSIT_REVERSED",
              entityId: movement.id,
              beforeData: {
                ...after,
                id: target.id,
                amountKobo: target.amountKobo.toString(),
                reversesEntryId: null,
              } as unknown as Prisma.InputJsonValue,
              afterData: after as unknown as Prisma.InputJsonValue,
              metadata: {
                idempotencyKey: key,
                actorEmail: actor.email,
                reason: input.reason,
              },
            });
            return { status: 201, body: after };
          },
        ),
      );
    },
  };
}
