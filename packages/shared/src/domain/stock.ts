import type { StockLocation, StockMovement } from "./types.js";

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
