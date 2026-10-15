import type { Product, StockLocation, StockMovement } from "./types.ts";

export type StockMovementReversal = Omit<
  StockMovement,
  "id" | "quantityUnits" | "reversesEntryId" | "occurredAt" | "createdAt"
> & {
  id: string;
  quantityUnits: number;
  reversesEntryId: string;
  occurredAt: Date;
  createdAt: Date;
};

export function calculateStockUnits(
  movements: ReadonlyArray<Pick<StockMovement, "quantityUnits">>,
): number {
  return movements.reduce((stock, movement) => stock + movement.quantityUnits, 0);
}

export function splitStockIntoPacks(
  stockUnits: number,
  unitsPerPack: number,
): { packs: number; remainingUnits: number } {
  if (!Number.isSafeInteger(stockUnits) || stockUnits < 0) {
    throw new RangeError("Stock units must be a nonnegative safe integer.");
  }
  if (!Number.isSafeInteger(unitsPerPack) || unitsPerPack <= 0) {
    throw new RangeError("Units per pack must be a positive safe integer.");
  }

  return {
    packs: Math.floor(stockUnits / unitsPerPack),
    remainingUnits: stockUnits % unitsPerPack,
  };
}

export function formatStockUnits(
  stockUnits: number,
  unitsPerPack: number,
  packName = "crate",
): string {
  const { packs, remainingUnits } = splitStockIntoPacks(stockUnits, unitsPerPack);
  const packLabel = packs === 1 ? packName : `${packName}s`;
  const unitLabel = remainingUnits === 1 ? "unit" : "units";

  if (packs === 0) {
    return `${remainingUnits} ${unitLabel}`;
  }
  if (remainingUnits === 0) {
    return `${packs} ${packLabel}`;
  }
  return `${packs} ${packLabel}, ${remainingUnits} ${unitLabel}`;
}

export function calculateWeightedAverageCostKobo(
  existingUnits: bigint,
  existingAverageCostKobo: bigint,
  receivedUnits: bigint,
  receivedTotalCostKobo: bigint,
): bigint {
  if (
    existingUnits < 0n ||
    existingAverageCostKobo < 0n ||
    receivedUnits <= 0n ||
    receivedTotalCostKobo < 0n
  ) {
    throw new RangeError("Weighted-average cost inputs are outside their valid ranges.");
  }

  const totalUnits = existingUnits + receivedUnits;
  const totalCost =
    existingUnits * existingAverageCostKobo + receivedTotalCostKobo;
  return (totalCost + totalUnits / 2n) / totalUnits;
}

export function assertStockWillRemainNonnegative(
  currentUnits: bigint,
  quantityDeltaUnits: bigint,
): void {
  if (quantityDeltaUnits === 0n) {
    throw new RangeError("Stock movements must change stock by a nonzero quantity.");
  }
  if (currentUnits + quantityDeltaUnits < 0n) {
    throw new RangeError("Stock cannot be reduced below zero.");
  }
}

export function validateAdjustmentLine(quantityDeltaUnits: number): void {
  if (!Number.isSafeInteger(quantityDeltaUnits) || quantityDeltaUnits === 0) {
    throw new RangeError(
      "Stock adjustment quantity must be a nonzero safe integer.",
    );
  }
}

export interface TransferLegPair {
  out: { location: StockLocation; direction: "OUT" };
  in: { location: StockLocation; direction: "IN" };
}

export function createTransferLegPair(
  from: StockLocation,
  to: StockLocation,
): TransferLegPair {
  if (from === to) {
    throw new RangeError("A stock transfer must move stock between two different locations.");
  }
  return {
    out: { location: from, direction: "OUT" },
    in: { location: to, direction: "IN" },
  };
}

export function buildStockMovementReversal(
  target: StockMovement,
  existingRows: readonly StockMovement[],
  reversalId: string,
  reversedAt: Date,
): StockMovementReversal {
  if (target.reversesEntryId !== null) {
    throw new RangeError("A reversal movement cannot itself be reversed.");
  }
  if (existingRows.some((movement) => movement.reversesEntryId === target.id)) {
    throw new RangeError("This stock movement has already been reversed.");
  }
  if (
    !reversalId ||
    reversalId === target.id ||
    existingRows.some((movement) => movement.id === reversalId)
  ) {
    throw new RangeError("Reversal id must be nonempty and unique.");
  }
  if (!Number.isFinite(reversedAt.getTime())) {
    throw new RangeError("Reversal date must be valid.");
  }

  return {
    ...target,
    id: reversalId,
    quantityUnits: -target.quantityUnits,
    reversesEntryId: target.id,
    occurredAt: reversedAt,
    createdAt: reversedAt,
  };
}

export function recomputeAverageCostKobo(
  movements: readonly StockMovement[],
): bigint {
  const reversedTargetIds = new Set(
    movements
      .filter((movement) => movement.reversesEntryId !== null)
      .map((movement) => movement.reversesEntryId as string),
  );

  const effective = movements
    .filter(
      (movement) =>
        movement.reversesEntryId === null &&
        !reversedTargetIds.has(movement.id),
    )
    .slice()
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  let units = 0n;
  let averageCostKobo = 0n;

  for (const movement of effective) {
    const delta = BigInt(movement.quantityUnits);
    if (delta > 0n) {
      if (movement.type === "PURCHASE" || movement.type === "ADJUSTMENT") {
        if (units === 0n) {
          averageCostKobo = movement.unitCostKobo;
        } else {
          averageCostKobo = calculateWeightedAverageCostKobo(
            units,
            averageCostKobo,
            delta,
            delta * movement.unitCostKobo,
          );
        }
        units += delta;
      } else {
        units += delta;
      }
    } else {
      units += delta;
      if (units <= 0n) {
        units = 0n;
        averageCostKobo = 0n;
      }
    }
  }

  return averageCostKobo;
}

export function stockByProductAndLocation(
  movements: readonly StockMovement[],
): Map<string, Map<StockLocation, number>> {
  const result = new Map<string, Map<StockLocation, number>>();
  for (const movement of movements) {
    if (movement.reversesEntryId !== null) {
      const target = movements.find((m) => m.id === movement.reversesEntryId);
      if (target && movement.quantityUnits === -target.quantityUnits) {
        continue;
      }
    }
    let byLocation = result.get(movement.productId);
    if (!byLocation) {
      byLocation = new Map();
      result.set(movement.productId, byLocation);
    }
    byLocation.set(
      movement.location,
      (byLocation.get(movement.location) ?? 0) + movement.quantityUnits,
    );
  }
  return result;
}

export function totalUnitsForProduct(
  movements: readonly StockMovement[],
  productId: string,
): number {
  const byLocation = stockByProductAndLocation(movements).get(productId);
  if (!byLocation) return 0;
  let total = 0;
  for (const units of byLocation.values()) {
    total += units;
  }
  return total;
}

export function stockWorthAtCost(
  movements: readonly StockMovement[],
  product: Pick<Product, "id" | "averageCostKobo">,
): bigint {
  const units = BigInt(totalUnitsForProduct(movements, product.id));
  return units * product.averageCostKobo;
}

export function stockWorthAtRetail(
  movements: readonly StockMovement[],
  product: Pick<Product, "id" | "retailPriceKobo">,
): bigint {
  const units = BigInt(totalUnitsForProduct(movements, product.id));
  return units * product.retailPriceKobo;
}

export function stockWorthAtWholesale(
  movements: readonly StockMovement[],
  product: Pick<Product, "id" | "unitsPerPack" | "wholesalePriceKobo">,
): bigint {
  const units = BigInt(totalUnitsForProduct(movements, product.id));
  const fullPacks = units / BigInt(product.unitsPerPack);
  return fullPacks * product.wholesalePriceKobo;
}

export function stockWorthByChannel(
  movements: readonly StockMovement[],
  product: Pick<
    Product,
    | "id"
    | "unitsPerPack"
    | "retailPriceKobo"
    | "wholesalePriceKobo"
    | "saleChannel"
  >,
): { retailKobo: bigint; wholesaleKobo: bigint; totalKobo: bigint } {
  const byLocation = stockByProductAndLocation(movements).get(product.id);
  if (!byLocation) {
    return { retailKobo: 0n, wholesaleKobo: 0n, totalKobo: 0n };
  }

  if (product.saleChannel === "RETAIL") {
    const units = BigInt(totalUnitsForProduct(movements, product.id));
    const retail = units * product.retailPriceKobo;
    return { retailKobo: retail, wholesaleKobo: 0n, totalKobo: retail };
  }

  if (product.saleChannel === "WHOLESALE") {
    const units = BigInt(totalUnitsForProduct(movements, product.id));
    const fullPacks = units / BigInt(product.unitsPerPack);
    const wholesale = fullPacks * product.wholesalePriceKobo;
    return { retailKobo: 0n, wholesaleKobo: wholesale, totalKobo: wholesale };
  }

  const retailUnits = BigInt(
    (byLocation.get("RETAIL_SHELF") ?? 0) + (byLocation.get("MARKET") ?? 0),
  );
  const warehouseUnits = BigInt(byLocation.get("WAREHOUSE") ?? 0);
  const retail = retailUnits * product.retailPriceKobo;
  const wholesale =
    (warehouseUnits / BigInt(product.unitsPerPack)) * product.wholesalePriceKobo;
  return { retailKobo: retail, wholesaleKobo: wholesale, totalKobo: retail + wholesale };
}

export function isLowStock(
  movements: readonly StockMovement[],
  product: Pick<Product, "id" | "reorderLevelUnits">,
): boolean {
  return totalUnitsForProduct(movements, product.id) <= product.reorderLevelUnits;
}
