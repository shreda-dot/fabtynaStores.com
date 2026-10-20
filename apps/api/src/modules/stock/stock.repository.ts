import type {
  StockAdjustment,
  StockAdjustmentLine,
  StockMovement,
  StockTransfer,
  StockTransferLeg,
  StockTransferLine,
} from "@fabtyna/shared";
import { counted, insertAuditLog, type AuditWrite, type TxContext } from "../../lib/tx.js";

export async function nextTransferSequence(ctx: TxContext): Promise<bigint> {
  counted(ctx);
  const rows = await ctx.tx.$queryRaw<Array<{ n: string }>>`
    SELECT nextval('transfer_reference_seq')::text AS n`;
  return BigInt(rows[0]!.n);
}

export interface TransferWrite {
  transfer: StockTransfer;
  lines: StockTransferLine[];
  legs: StockTransferLeg[];
  movements: StockMovement[];
  actorId: string;
  audit: AuditWrite;
}

const byProductLocationId = (a: StockMovement, b: StockMovement): number =>
  (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0) ||
  (a.location < b.location ? -1 : a.location > b.location ? 1 : 0) ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export async function insertTransfer(ctx: TxContext, write: TransferWrite): Promise<void> {
  const { transfer, lines, legs, movements, actorId } = write;

  counted(ctx);
  await ctx.tx.stockTransfer.create({
    data: {
      id: transfer.id,
      createdById: actorId,
      from: transfer.from,
      to: transfer.to,
      reason: transfer.reason,
      reference: transfer.reference,
      transferredAt: transfer.transferredAt,
    },
  });

  counted(ctx);
  await ctx.tx.stockTransferLine.createMany({
    data: lines.map((line) => ({
      id: line.id,
      transferId: transfer.id,
      productId: line.productId,
      quantityUnits: line.quantityUnits,
    })),
  });

  counted(ctx);
  await ctx.tx.stockTransferLeg.createMany({
    data: legs.map((leg) => ({
      id: leg.id,
      transferLineId: leg.transferLineId,
      location: leg.location,
      direction: leg.direction,
    })),
  });

  counted(ctx);
  await ctx.tx.stockMovement.createMany({
    data: [...movements].sort(byProductLocationId).map((movement) => ({
      id: movement.id,
      productId: movement.productId,
      location: movement.location,
      type: "TRANSFER" as const,
      quantityUnits: movement.quantityUnits,
      unitCostKobo: movement.unitCostKobo,
      transferLegId: movement.transferLegId,
      occurredAt: movement.occurredAt,
    })),
  });

  await insertAuditLog(ctx, "StockTransfer", {
    ...write.audit,
    entityId: transfer.id,
  });
}

export interface AdjustmentWrite {
  adjustment: StockAdjustment;
  lines: StockAdjustmentLine[];
  movements: StockMovement[];
  productUpdates: ReadonlyArray<{ id: string; averageCostKobo: bigint }>;
  actorId: string;
  audit: AuditWrite;
}

export async function updateProductCosts(
  ctx: TxContext,
  updates: ReadonlyArray<{ id: string; averageCostKobo: bigint }>,
): Promise<void> {
  if (updates.length === 0) return;
  counted(ctx);
  const ids = updates.map((update) => update.id);
  const costs = updates.map((update) => update.averageCostKobo.toString());
  await ctx.tx.$executeRaw`
    UPDATE products AS p
       SET "averageCostKobo" = v.cost::bigint, "updatedAt" = CURRENT_TIMESTAMP
      FROM unnest(${ids}::text[], ${costs}::text[]) AS v(id, cost)
     WHERE p.id = v.id`;
}

export async function insertAdjustment(ctx: TxContext, write: AdjustmentWrite): Promise<void> {
  const { adjustment, lines, movements, actorId } = write;
  counted(ctx);
  await ctx.tx.stockAdjustment.create({
    data: {
      id: adjustment.id,
      createdById: actorId,
      reason: adjustment.reason,
      status: "COMPLETED",
      adjustedAt: adjustment.adjustedAt,
    },
  });

  counted(ctx);
  await ctx.tx.stockAdjustmentLine.createMany({
    data: lines.map((line) => ({
      id: line.id,
      adjustmentId: adjustment.id,
      productId: line.productId,
      location: line.location,
      quantityDeltaUnits: line.quantityDeltaUnits,
      unitCostKobo: line.unitCostKobo,
      reason: line.reason,
    })),
  });

  counted(ctx);
  await ctx.tx.stockMovement.createMany({
    data: [...movements].sort(byProductLocationId).map((movement) => ({
      id: movement.id,
      productId: movement.productId,
      location: movement.location,
      type: "ADJUSTMENT" as const,
      quantityUnits: movement.quantityUnits,
      unitCostKobo: movement.unitCostKobo,
      adjustmentLineId: movement.adjustmentLineId,
      occurredAt: movement.occurredAt,
    })),
  });

  await updateProductCosts(ctx, write.productUpdates);
  await insertAuditLog(ctx, "StockAdjustment", { ...write.audit, entityId: adjustment.id });
}

export interface LockedAdjustment extends StockAdjustment {}

export async function lockAdjustment(ctx: TxContext, id: string): Promise<LockedAdjustment | null> {
  counted(ctx);
  const rows = await ctx.tx.$queryRaw<LockedAdjustment[]>`
    SELECT id, "createdById", reason, status, "adjustedAt", "createdAt"
      FROM stock_adjustments
     WHERE id = ${id}
       FOR UPDATE`;
  return rows[0] ?? null;
}

export async function loadAdjustmentLines(ctx: TxContext, adjustmentId: string): Promise<StockAdjustmentLine[]> {
  counted(ctx);
  return ctx.tx.stockAdjustmentLine.findMany({
    where: { adjustmentId },
    orderBy: { id: "asc" },
  });
}

export async function loadProductMovements(
  ctx: TxContext,
  productIds: readonly string[],
): Promise<StockMovement[]> {
  const ids = [...new Set(productIds)].sort();
  if (ids.length === 0) return [];
  counted(ctx);
  return ctx.tx.stockMovement.findMany({
    where: { productId: { in: ids } },
    orderBy: [{ productId: "asc" }, { location: "asc" }, { occurredAt: "asc" }, { id: "asc" }],
  });
}

export async function voidAdjustmentWrites(
  ctx: TxContext,
  input: {
    adjustmentId: string;
    reversals: readonly StockMovement[];
    productUpdates: ReadonlyArray<{ id: string; averageCostKobo: bigint }>;
    audit: AuditWrite;
  },
): Promise<void> {
  if (input.reversals.length > 0) {
    counted(ctx);
    await ctx.tx.stockMovement.createMany({
      data: [...input.reversals].sort(byProductLocationId).map((movement) => ({
        id: movement.id,
        productId: movement.productId,
        location: movement.location,
        type: "ADJUSTMENT" as const,
        quantityUnits: movement.quantityUnits,
        unitCostKobo: movement.unitCostKobo,
        adjustmentLineId: movement.adjustmentLineId,
        reversesEntryId: movement.reversesEntryId,
        occurredAt: movement.occurredAt,
      })),
    });
  }

  await updateProductCosts(ctx, input.productUpdates);
  counted(ctx);
  await ctx.tx.stockAdjustment.update({
    where: { id: input.adjustmentId },
    data: { status: "VOIDED" },
  });
  await insertAuditLog(ctx, "StockAdjustment", { ...input.audit, entityId: input.adjustmentId });
}
