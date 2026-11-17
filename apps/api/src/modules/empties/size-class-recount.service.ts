import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import type { Actor } from "../../auth/actor.js";
import { businessRuleError, validationError } from "../../lib/errors.js";
import { hashRequestBody } from "../../lib/idempotency.js";
import { counted, createWriteRunner, insertAuditLog, type TxContext } from "../../lib/tx.js";
import type { TxTimeouts } from "../../lib/tx-options.js";
import type { SizeClassRecountBody } from "./empties.schemas.js";
import type { SizeClassPhase } from "./size-class-mode.js";

type SizeClassRow = {
  typeId: string;
  ownerId: string;
  ownerName: string;
  label: string;
  capacity: number;
  quantity: number;
};

const MAX_MOVEMENT_QUANTITY = 2_147_483_647n;

async function lockPhase(ctx: TxContext): Promise<SizeClassPhase> {
  counted(ctx);
  const rows = await ctx.tx.$queryRaw<Array<{ phase: SizeClassPhase }>>`
    SELECT phase FROM empties_size_class_mode WHERE id = 1 FOR UPDATE`;
  if (rows.length !== 1) throw new Error("The empties size-class mode is missing.");
  return rows[0]!.phase;
}

async function getActiveSizeClasses(prisma: PrismaClient): Promise<SizeClassRow[]> {
  return prisma.$queryRaw<SizeClassRow[]>`
    SELECT t.id AS "typeId", o.id AS "ownerId", o.name AS "ownerName",
           t.label, t.capacity, COALESCE(b.quantity, 0) AS quantity
      FROM empties_types t
      JOIN empties_owners o ON o.id = t."ownerId"
      LEFT JOIN empties_balances b ON b."typeId" = t.id
     WHERE t.kind = 'BOTTLE'::"EmptiesKind" AND t.capacity IS NOT NULL
       AND t."isActive" = TRUE AND o."isActive" = TRUE
     ORDER BY o.name, t.capacity, t.id`;
}

function recountDto(phase: SizeClassPhase, classes: SizeClassRow[]) {
  return {
    phase,
    classes: classes.map((row) => ({
      typeId: row.typeId,
      ownerId: row.ownerId,
      ownerName: row.ownerName,
      label: row.label,
      capacity: row.capacity,
      quantity: row.quantity,
    })),
  };
}

export function createSizeClassRecountService(options: {
  prisma: PrismaClient;
  now?: () => Date;
  log?: (entry: Record<string, unknown>) => void;
  txTimeouts?: TxTimeouts;
}) {
  const { prisma } = options;
  const runner = createWriteRunner({
    prisma,
    now: options.now ?? (() => new Date()),
    log: options.log,
    txTimeouts: options.txTimeouts,
  });

  return {
    async getSizeClassRecount() {
      const modes = await prisma.$queryRaw<Array<{ phase: SizeClassPhase }>>`
        SELECT phase FROM empties_size_class_mode WHERE id = 1`;
      if (modes.length !== 1) throw new Error("The empties size-class mode is missing.");
      return recountDto(modes[0]!.phase, await getActiveSizeClasses(prisma));
    },

    async beginSizeClassRecount(actor: Actor, key: string | null) {
      const route = "POST /empties/size-class-recount/begin";
      return runner.runWrite(route, {}, (ctx) =>
        runner.withIdempotency(
          ctx,
          { actorId: actor.id, route, key, requestHash: hashRequestBody({}) },
          async () => {
            const phase = await lockPhase(ctx);
            if (phase === "RECOUNT_PENDING") {
              throw businessRuleError("An empties recount is already in progress.");
            }
            counted(ctx);
            await ctx.tx.$executeRaw`
              UPDATE empties_size_class_mode SET phase = 'RECOUNT_PENDING' WHERE id = 1`;
            await insertAuditLog(ctx, "EmptiesSizeClassMode", {
              actorId: actor.id,
              action: "EMPTIES_SIZE_CLASS_RECOUNT_STARTED",
              entityId: "1",
              beforeData: { phase },
              afterData: { phase: "RECOUNT_PENDING" },
              metadata: { idempotencyKey: key, actorEmail: actor.email },
            });
            return { status: 200, body: { phase: "RECOUNT_PENDING" } };
          },
        ),
      );
    },

    async submitSizeClassRecount(input: SizeClassRecountBody, actor: Actor, key: string | null) {
      const route = "POST /empties/size-class-recount";
      return runner.runWrite(route, {}, (ctx) =>
        runner.withIdempotency(
          ctx,
          { actorId: actor.id, route, key, requestHash: hashRequestBody(input) },
          async () => {
            const phase = await lockPhase(ctx);
            if (phase !== "RECOUNT_PENDING") {
              throw businessRuleError("Start a recount before submitting counted empties.");
            }
            counted(ctx);
            const classes = await ctx.tx.$queryRaw<SizeClassRow[]>`
              SELECT t.id AS "typeId", o.id AS "ownerId", o.name AS "ownerName",
                     t.label, t.capacity, COALESCE(b.quantity, 0) AS quantity
                FROM empties_types t
                JOIN empties_owners o ON o.id = t."ownerId"
                LEFT JOIN empties_balances b ON b."typeId" = t.id
               WHERE t.kind = 'BOTTLE'::"EmptiesKind" AND t.capacity IS NOT NULL
                 AND t."isActive" = TRUE AND o."isActive" = TRUE
               ORDER BY o.name, t.capacity, t.id
               FOR UPDATE OF t`;
            if (classes.length === 0) {
              throw businessRuleError("Add active brewery bottle size classes before confirming a recount.");
            }
            const submittedIds = input.counts.map((row) => row.typeId).sort();
            const activeIds = classes.map((row) => row.typeId).sort();
            if (submittedIds.length !== activeIds.length
                || submittedIds.some((id, index) => id !== activeIds[index])) {
              throw validationError("The recount must include exactly one count for every active brewery size class.");
            }

            const submittedByType = new Map(input.counts.map((row) => [row.typeId, row]));
            const changes: Array<{
              typeId: string;
              ownerName: string;
              label: string;
              capacity: number;
              previousBottles: number;
              countedBottles: number;
              delta: number;
              movementId: string | null;
            }> = [];
            for (const sizeClass of classes) {
              const count = submittedByType.get(sizeClass.typeId)!;
              if (count.looseBottles >= sizeClass.capacity) {
                throw validationError(
                  `Loose bottles for '${sizeClass.label}' must be fewer than ${sizeClass.capacity}.`,
                  { typeId: sizeClass.typeId, capacity: sizeClass.capacity },
                );
              }
              const countedBottles = BigInt(count.emptyCrates) * BigInt(sizeClass.capacity)
                + BigInt(count.looseBottles);
              if (countedBottles > MAX_MOVEMENT_QUANTITY) {
                throw validationError(`The counted bottle total for '${sizeClass.label}' is too large.`);
              }
              const delta = Number(countedBottles - BigInt(sizeClass.quantity));
              let movementId: string | null = null;
              if (delta !== 0) {
                movementId = randomUUID();
                counted(ctx);
                const movement = await ctx.tx.emptiesMovement.create({
                  data: {
                    id: movementId,
                    typeId: sizeClass.typeId,
                    movementType: "ADJUSTMENT",
                    quantity: delta,
                    note: input.reason,
                    createdById: actor.id,
                  },
                });
                await insertAuditLog(ctx, "EmptiesMovement", {
                  actorId: actor.id,
                  action: "EMPTIES_SIZE_CLASS_RECOUNT_ADJUSTMENT",
                  entityId: movement.id,
                  afterData: {
                    id: movement.id,
                    typeId: sizeClass.typeId,
                    ownerId: sizeClass.ownerId,
                    ownerName: sizeClass.ownerName,
                    label: sizeClass.label,
                    capacity: sizeClass.capacity,
                    quantity: delta,
                    countedBottles: Number(countedBottles),
                    reason: input.reason,
                  } as unknown as Prisma.InputJsonValue,
                  metadata: { idempotencyKey: key, actorEmail: actor.email, reason: input.reason },
                });
              }
              changes.push({
                typeId: sizeClass.typeId,
                ownerName: sizeClass.ownerName,
                label: sizeClass.label,
                capacity: sizeClass.capacity,
                previousBottles: sizeClass.quantity,
                countedBottles: Number(countedBottles),
                delta,
                movementId,
              });
            }

            counted(ctx);
            await ctx.tx.$executeRaw`
              UPDATE empties_size_class_mode SET phase = 'READY' WHERE id = 1`;
            await insertAuditLog(ctx, "EmptiesSizeClassMode", {
              actorId: actor.id,
              action: "EMPTIES_SIZE_CLASS_RECOUNT_CONFIRMED",
              entityId: "1",
              beforeData: { phase: "RECOUNT_PENDING" },
              afterData: { phase: "READY", changes } as unknown as Prisma.InputJsonValue,
              metadata: { idempotencyKey: key, actorEmail: actor.email, reason: input.reason },
            });
            return { status: 200, body: { phase: "READY", changes } };
          },
        ),
      );
    },
  };
}
