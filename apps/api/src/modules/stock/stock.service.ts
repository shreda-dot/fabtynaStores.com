import type { Prisma } from "../../../generated/prisma/client";
import {
  assertStockWillRemainNonnegative,
  calculateStockUnits,
  calculateWeightedAverageCostKobo,
  splitStockIntoPacks,
} from "@fabtyna/shared";

export {
  assertStockWillRemainNonnegative,
  calculateStockUnits,
  calculateWeightedAverageCostKobo,
  splitStockIntoPacks,
};

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
