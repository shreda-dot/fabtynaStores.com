import { randomUUID } from "node:crypto";
import { receivePurchase, type PurchaseLine } from "@fabtyna/shared";
import type { PrismaClient } from "../../../generated/prisma/client.js";
import type { Actor } from "../../auth/actor.js";
import { AppError, businessRuleError, validationError } from "../../lib/errors.js";
import { counted, type TxContext } from "../../lib/tx.js";
import { DEFAULT_TX_TIMEOUTS, type TxTimeouts } from "../../lib/tx-options.js";
import type { CreatePurchaseDto } from "./purchases.schemas.js";
import { assertPurchasesAvailable, lockSizeClassPhase } from "../empties/size-class-mode.js";

type Requirement = {
  purchaseLineId: string;
  typeId: string;
  kind: "CRATE" | "BOTTLE";
  quantity: number;
  manualCrateCount: boolean;
  countPerUnitSnapshot: number | null;
  countPerPackSnapshot: number | null;
  crateCountSnapshot: number | null;
  cratesPerPackSnapshot: number | null;
};

const MAX_COUNT = 2_147_483_647n;

function checkedCount(value: bigint, message: string): number {
  if (value < 0n || value > MAX_COUNT) throw validationError(message);
  return Number(value);
}

async function buildPurchaseEmptiesPlan(
  ctx: TxContext,
  dto: { lines: ReadonlyArray<{ emptiesCrateCount?: number }> },
  lines: PurchaseLine[],
  suggestPartialCrates: boolean,
) {
  const productIds = [...new Set(lines.map((line) => line.productId))].sort();
  counted(ctx);
  const classifications = await ctx.tx.purchaseEmptiesProduct.findMany({
    where: { productId: { in: productIds } },
  });
  const classificationById = new Map(classifications.map((row) => [row.productId, row.classification]));
  counted(ctx);
  const packaging = await ctx.tx.purchaseEmptiesPackaging.findMany({
    where: { productId: { in: productIds } },
    include: { type: { include: { owner: true } } },
    orderBy: [{ productId: "asc" }, { kind: "asc" }],
  });
  const snapshots: Array<{ purchaseLineId: string; classification: "RETURNABLE" | "NON_RETURNABLE" }> = [];
  const requirements: Requirement[] = [];
  const requiredByType = new Map<string, number>();
  for (const [index, line] of lines.entries()) {
    const classification = classificationById.get(line.productId);
    if (classification === undefined) {
      throw businessRuleError(`Line ${index + 1}: classify this product in Purchase empties setup before saving the purchase.`, {
        productId: line.productId,
      });
    }
    snapshots.push({ purchaseLineId: line.id, classification });
    const mappings = packaging.filter((row) => row.productId === line.productId);
    if (classification === "RETURNABLE" && mappings.length === 0) {
      throw businessRuleError(`Line ${index + 1}: set up this product's purchase containers in Purchase empties setup first.`, {
        productId: line.productId,
      });
    }
    if (classification !== "RETURNABLE") continue;
    for (const mapping of mappings) {
      if (!mapping.type.isActive || !mapping.type.owner.isActive) {
        throw businessRuleError(`Line ${index + 1}: reactivate '${mapping.type.label}' and its brewery, or update Purchase empties setup.`);
      }
      let manualCrateCount = mapping.kind === "CRATE"
        && (line.unit === "UNIT" || !Number.isInteger(line.quantity));
      let quantity: number;
      let crateCountSnapshot: number | null = null;
      let cratesPerPackSnapshot: number | null = null;
      if (mapping.kind === "BOTTLE") {
        if (mapping.countPerUnit === null) throw new Error("Bottle purchase configuration has no unit count.");
        if (mapping.type.capacity === null) {
          if (mapping.cratesPerPack !== null) {
            throw businessRuleError(`Line ${index + 1}: remove the size-class crate rate from the legacy bottle type.`);
          }
          quantity = checkedCount(BigInt(line.quantityUnits) * BigInt(mapping.countPerUnit), "The bottle count is too large.");
        } else {
          manualCrateCount = true;
          if (mapping.countPerUnit !== 1) {
            throw businessRuleError(`Line ${index + 1}: a size-class bottle mapping must count one bottle per product unit.`);
          }
          const entered = dto.lines[index]!.emptiesCrateCount;
          const derived = mapping.cratesPerPack === null
            ? Math.ceil(line.quantityUnits / mapping.type.capacity)
            : line.unit === "PACK" && Number.isInteger(line.quantity * mapping.cratesPerPack)
              ? line.quantity * mapping.cratesPerPack
              : Math.ceil(line.quantityUnits / mapping.type.capacity);
          if (entered === undefined && !suggestPartialCrates) {
            throw validationError(`Line ${index + 1}: confirm the number of ${mapping.type.capacity}-bottle empties crates for this purchase.`, {
              field: `lines.${index}.emptiesCrateCount`,
            });
          }
          crateCountSnapshot = entered ?? derived;
          cratesPerPackSnapshot = mapping.cratesPerPack;
          quantity = checkedCount(
            BigInt(crateCountSnapshot) * BigInt(mapping.type.capacity),
            "The required empty-bottle count is too large.",
          );
        }
      } else if (manualCrateCount) {
        if (mapping.countPerPack === null) throw new Error("Crate purchase configuration has no pack count.");
        const entered = dto.lines[index]!.emptiesCrateCount;
        if (entered === undefined && line.unit === "PACK" && !suggestPartialCrates) {
          throw validationError(`Line ${index + 1}: enter the number of whole crates delivered for the partial pack.`, {
            field: `lines.${index}.emptiesCrateCount`,
          });
        }
        quantity = entered ?? (line.unit === "PACK"
          ? checkedCount(BigInt(Math.ceil(line.quantity)) * BigInt(mapping.countPerPack), "The crate count is too large.")
          : 0);
      } else {
        if (mapping.countPerPack === null) throw new Error("Crate purchase configuration has no pack count.");
        quantity = checkedCount(BigInt(line.quantity) * BigInt(mapping.countPerPack), "The crate count is too large.");
      }
      requirements.push({
        purchaseLineId: line.id, typeId: mapping.typeId, kind: mapping.kind, quantity,
        manualCrateCount, countPerUnitSnapshot: mapping.countPerUnit, countPerPackSnapshot: mapping.countPerPack,
        crateCountSnapshot,
        cratesPerPackSnapshot,
      });
      requiredByType.set(mapping.typeId, checkedCount(
        BigInt(requiredByType.get(mapping.typeId) ?? 0) + BigInt(quantity),
        "The combined container count is too large.",
      ));
    }
  }
  return { snapshots, requirements, requiredByType, packaging };
}

export async function recordPurchaseEmpties(
  ctx: TxContext,
  dto: CreatePurchaseDto,
  lines: PurchaseLine[],
  actor: Actor,
): Promise<void> {
  const { snapshots, requirements, requiredByType, packaging } = await buildPurchaseEmptiesPlan(ctx, dto, lines, false);
  const allTypeIds = [...requiredByType.keys()].sort();
  const typeIds = allTypeIds.filter((id) => requiredByType.get(id)! > 0);
  if (allTypeIds.length > 0) {
    counted(ctx);
    const lockedTypes = await ctx.tx.$queryRaw<Array<{ id: string; label: string; isActive: boolean; ownerIsActive: boolean }>>`
      SELECT t.id, t.label, t."isActive", o."isActive" AS "ownerIsActive"
        FROM empties_types t JOIN empties_owners o ON o.id = t."ownerId"
       WHERE t.id = ANY(${allTypeIds}::text[]) ORDER BY t.id FOR UPDATE OF t FOR SHARE OF o`;
    if (lockedTypes.length !== allTypeIds.length || lockedTypes.some((type) => !type.isActive || !type.ownerIsActive)) {
      throw businessRuleError("A purchase container type or its brewery is inactive. Reactivate it or update Purchase empties setup.");
    }
  }
  counted(ctx);
  await ctx.tx.purchaseEmptiesLineSnapshot.createMany({ data: snapshots });
  if (requirements.length > 0) {
    counted(ctx);
    await ctx.tx.purchaseEmptiesRequirement.createMany({
      data: requirements.map((requirement) => ({
        ...requirement,
        crateCountSnapshot: requirement.crateCountSnapshot,
        cratesPerPackSnapshot: requirement.cratesPerPackSnapshot,
      })),
    });
  }
  const checks = new Map<string, number>();
  for (const typeId of typeIds) {
    counted(ctx);
    const check = await ctx.tx.purchaseEmptiesCheck.create({
      data: { purchaseId: lines[0]!.purchaseId, typeId, availableQuantity: 0, capturedTxid: 0n },
    });
    checks.set(typeId, check.availableQuantity);
  }
  const resolutions = new Map((dto.emptiesResolutions ?? []).map((row) => [row.typeId, row]));
  if ([...resolutions.keys()].some((id) => !typeIds.includes(id))) {
    throw validationError("Remove the shortage choice for a container that is not needed in this purchase.");
  }
  for (const typeId of typeIds) {
    const required = requiredByType.get(typeId)!;
    const available = checks.get(typeId)!;
    const type = packaging.find((row) => row.typeId === typeId)!.type;
    const returned = type.capacity === null
      ? Math.min(required, available)
      : Math.floor(Math.min(required, available) / type.capacity) * type.capacity;
    const shortage = required - returned;
    const resolution = resolutions.get(typeId);
    const free = resolution?.suppliedFree ?? 0;
    const owed = resolution?.owed ?? 0;
    if (free + owed !== shortage) {
      const label = packaging.find((row) => row.typeId === typeId)!.type.label;
      throw businessRuleError(
        `You have ${available} '${label}' empties and need ${required}. Short by ${shortage}. Refresh the check and choose how the shortage is covered.`,
        { typeId, available, required, shortage },
      );
    }
    const capacity = packaging.find((row) => row.typeId === typeId)!.type.capacity;
    if (capacity !== null && (free % capacity !== 0 || owed % capacity !== 0)) {
      throw businessRuleError(
        `For '${packaging.find((row) => row.typeId === typeId)!.type.label}', choose free supply and supplier debt in whole ${capacity}-bottle crates.`,
        { typeId, capacity, suppliedFree: free, owed },
      );
    }
    if (owed > 0 && dto.supplierId === null) {
      throw validationError("Choose a supplier before recording empties owed to them.", { field: "supplierId", typeId });
    }
    const purchaseId = lines[0]!.purchaseId;
    if (returned > 0) {
      const eventId = randomUUID();
      counted(ctx);
      await ctx.tx.supplierEmptiesEvent.create({
        data: { id: eventId, eventType: "RETURNED_FOR_PURCHASE", typeId, purchaseId, quantity: -returned, createdById: actor.id },
      });
      counted(ctx);
      await ctx.tx.emptiesMovement.create({
        data: { id: randomUUID(), typeId, movementType: "RETURNED_TO_OWNER", quantity: -returned, createdById: actor.id, supplierEmptiesEventId: eventId },
      });
    }
    if (free > 0) {
      counted(ctx);
      await ctx.tx.supplierEmptiesEvent.create({
        data: { id: randomUUID(), eventType: "SUPPLIED_FREE", typeId, purchaseId, quantity: free, createdById: actor.id },
      });
    }
    if (owed > 0 && dto.supplierId !== null) {
      const obligationId = randomUUID();
      counted(ctx);
      await ctx.tx.supplierEmptiesObligation.create({
        data: { id: obligationId, supplierId: dto.supplierId, typeId, purchaseId, createdById: actor.id },
      });
      counted(ctx);
      await ctx.tx.supplierEmptiesEvent.create({
        data: { id: randomUUID(), eventType: "PURCHASE_DEBT", typeId, purchaseId, obligationId, quantity: owed, createdById: actor.id },
      });
    }
  }
}

export async function previewPurchaseEmpties(
  prisma: PrismaClient,
  input: {
    lines: Array<Omit<CreatePurchaseDto["lines"][number], "lineTotalKobo">>;
    amendingPurchaseId?: string;
  },
  actor: Actor,
  timeouts: TxTimeouts = DEFAULT_TX_TIMEOUTS,
) {
  return prisma.$transaction(async (tx) => {
    const ctx: TxContext = { tx, queries: { count: 0 } };
    const ids = [...new Set(input.lines.map((line) => line.productId))];
    await assertPurchasesAvailable(ctx, await lockSizeClassPhase(ctx), ids);
    const products = await tx.product.findMany({ where: { id: { in: ids } } });
    for (const [index, line] of input.lines.entries()) {
      const product = products.find((item) => item.id === line.productId);
      if (!product || product.deletedAt !== null) {
        throw validationError(`Line ${index + 1}: choose an active product.`, { field: `lines.${index}.productId` });
      }
    }
    const { purchaseLines } = receivePurchase({
      supplierId: null, createdById: actor.id, location: "WAREHOUSE", purchasedAt: new Date(),
      notes: null, reference: null, dueDate: null, amountPaidNowKobo: 0n,
      lines: input.lines.map((line) => ({
        productId: line.productId, unit: line.unit, quantity: line.quantity, lineTotalKobo: 0n,
      })),
    }, products, [], randomUUID);
    const plan = await buildPurchaseEmptiesPlan(ctx, input, purchaseLines, true);
    const types = [...plan.requiredByType.keys()].sort();
    const balances = await tx.emptiesBalance.findMany({ where: { typeId: { in: types } } });
    const byType = new Map(balances.map((row) => [row.typeId, row.quantity]));
    if (input.amendingPurchaseId !== undefined) {
      const purchase = await tx.purchase.findUnique({
        where: { id: input.amendingPurchaseId },
        select: { status: true },
      });
      if (purchase === null) throw new AppError(404, "NOT_FOUND", "Purchase not found.");
      if (purchase.status !== "RECEIVED") {
        throw businessRuleError("Only a received purchase can be edited. Refresh the purchase and try again.");
      }
      const liveSettlements = await tx.supplierEmptiesEvent.findFirst({
        where: {
          purchaseId: input.amendingPurchaseId, eventType: "DEBT_SETTLEMENT",
          reversesEntryId: null, reversedBy: { none: {} },
        },
        select: { id: true },
      });
      if (liveSettlements !== null) {
        throw businessRuleError("Correct the linked empties settlements before voiding or editing this purchase.");
      }
      const returns = await tx.supplierEmptiesEvent.findMany({
        where: {
          purchaseId: input.amendingPurchaseId, eventType: "RETURNED_FOR_PURCHASE",
          typeId: { in: types }, reversesEntryId: null, reversedBy: { none: {} },
        },
        select: { typeId: true, quantity: true },
      });
      for (const entry of returns) {
        byType.set(entry.typeId, checkedCount(
          BigInt(byType.get(entry.typeId) ?? 0) - BigInt(entry.quantity),
          "The available container count after correcting this purchase is too large.",
        ));
      }
    }
    return {
      lines: purchaseLines.map((line, index) => ({
        index,
        requirements: plan.requirements.filter((entry) => entry.purchaseLineId === line.id).map((entry) => ({
          typeId: entry.typeId, kind: entry.kind, quantity: entry.quantity,
          manualCrateCount: entry.manualCrateCount,
          suggestedCrateCount: entry.crateCountSnapshot
            ?? (entry.manualCrateCount && line.unit === "PACK" ? entry.quantity : null),
        })),
      })),
      totals: types.map((typeId) => {
        const mapping = plan.packaging.find((row) => row.typeId === typeId)!;
        const required = plan.requiredByType.get(typeId)!;
        const available = byType.get(typeId) ?? 0;
        const returned = mapping.type.capacity === null
          ? Math.min(required, available)
          : Math.floor(Math.min(required, available) / mapping.type.capacity) * mapping.type.capacity;
        return {
          typeId, kind: mapping.kind, label: mapping.type.label,
          required, available, shortage: Math.max(0, required - returned),
        };
      }),
    };
  }, { timeout: timeouts.timeoutMs, maxWait: timeouts.maxWaitMs });
}

export async function reversePurchaseEmpties(ctx: TxContext, purchaseId: string, actor: Actor): Promise<void> {
  counted(ctx);
  const liveSettlements = await ctx.tx.supplierEmptiesEvent.findMany({
    where: { purchaseId, eventType: "DEBT_SETTLEMENT", reversesEntryId: null, reversedBy: { none: {} } },
    select: { id: true },
    take: 1,
  });
  if (liveSettlements.length > 0) {
    throw businessRuleError("Correct the linked empties settlements before voiding or editing this purchase.", { purchaseId });
  }
  counted(ctx);
  const events = await ctx.tx.supplierEmptiesEvent.findMany({
    where: {
      purchaseId,
      eventType: { in: ["RETURNED_FOR_PURCHASE", "SUPPLIED_FREE", "PURCHASE_DEBT"] },
      reversesEntryId: null,
      reversedBy: { none: {} },
    },
    orderBy: [{ typeId: "asc" }, { id: "asc" }],
  });
  if (events.length === 0) return;
  const obligations = [...new Set(events.flatMap((event) => event.obligationId ? [event.obligationId] : []))].sort();
  if (obligations.length > 0) {
    counted(ctx);
    await ctx.tx.$queryRaw`SELECT id FROM supplier_empties_obligations WHERE id = ANY(${obligations}::text[]) ORDER BY id FOR UPDATE`;
  }
  const types = [...new Set(events.map((event) => event.typeId))].sort();
  counted(ctx);
  await ctx.tx.$queryRaw`SELECT id FROM empties_types WHERE id = ANY(${types}::text[]) ORDER BY id FOR UPDATE`;
  for (const event of events) {
    counted(ctx);
    await ctx.tx.supplierEmptiesEvent.create({
      data: {
        id: randomUUID(), eventType: event.eventType, typeId: event.typeId, purchaseId: event.purchaseId,
        obligationId: event.obligationId, quantity: -event.quantity, reversesEntryId: event.id,
        note: "Purchase voided or amended", createdById: actor.id,
      },
    });
    if (event.eventType === "RETURNED_FOR_PURCHASE") {
      counted(ctx);
      const movement = await ctx.tx.emptiesMovement.findFirst({
        where: { supplierEmptiesEventId: event.id, reversesEntryId: null },
      });
      if (movement === null) throw new Error("Purchase empties return is missing its on-hand movement.");
      counted(ctx);
      await ctx.tx.emptiesMovement.create({
        data: {
          id: randomUUID(), typeId: movement.typeId, movementType: movement.movementType,
          quantity: -movement.quantity, note: movement.note, createdById: actor.id, saleId: movement.saleId,
          supplierEmptiesEventId: movement.supplierEmptiesEventId, reversesEntryId: movement.id,
        },
      });
    }
  }
}
