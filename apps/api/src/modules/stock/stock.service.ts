import type { Prisma } from "../../../generated/prisma/client";

export function calculateStockUnits(movementQuantities: readonly number[]): number {
  return movementQuantities.reduce((stock, quantity) => stock + quantity, 0);
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

// The caller must invoke this inside the same transaction that writes the
// movement. Locking the product row serializes stock changes for that product;
// the aggregate is ledger-derived and is never stored as a stock balance.
export async function createStockMovementWithinTransaction(
  transaction: Prisma.TransactionClient,
  movement: Prisma.StockMovementUncheckedCreateInput,
): Promise<void> {
  if (!Number.isSafeInteger(movement.quantityUnits) || movement.quantityUnits === 0) {
    throw new RangeError("Stock movement quantity must be a nonzero safe integer.");
  }

  await transaction.$queryRaw`
    SELECT id
    FROM products
    WHERE id = ${movement.productId}
    FOR UPDATE
  `;

  const balances = await transaction.$queryRaw<Array<{ units: bigint }>>`
    SELECT COALESCE(SUM("quantityUnits"), 0) AS units
    FROM stock_movements
    WHERE "productId" = ${movement.productId}
      AND location = ${movement.location}::"StockLocation"
  `;
  const currentUnits = balances[0]?.units ?? 0n;
  assertStockWillRemainNonnegative(currentUnits, BigInt(movement.quantityUnits));
  await transaction.stockMovement.create({ data: movement });
}
