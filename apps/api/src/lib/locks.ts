import type { Product, StockLocation } from "@fabtyna/shared";
import { counted, type TxContext } from "./tx.js";

/**
 * Row locks shared by every write module. The ONE order is documented in
 * docs/AI_CONTEXT.md:
 *
 *   document row (sale / purchase) -> products (by id) -> stock_balances
 *   (by productId, location) -> account_balances (by accountId) -> the party
 *   row (customer / supplier).
 *
 * One statement per table, always sorted, so two requests over overlapping
 * rows wait for each other instead of deadlocking.
 */

interface ProductRow {
  id: string;
  name: string;
  sku: string | null;
  category: Product["category"];
  packName: string;
  unitsPerPack: number;
  saleChannel: Product["saleChannel"];
  retailPriceKobo: bigint;
  wholesalePriceKobo: bigint;
  averageCostKobo: bigint;
  reorderLevelUnits: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Locks the products an operation touches, in id order. */
export async function lockProducts(ctx: TxContext, productIds: readonly string[]): Promise<Product[]> {
  counted(ctx);
  const ids = [...new Set(productIds)].sort();
  const rows = await ctx.tx.$queryRaw<ProductRow[]>`
    SELECT id, name, sku, category, "packName", "unitsPerPack", "saleChannel",
           "retailPriceKobo", "wholesalePriceKobo", "averageCostKobo",
           "reorderLevelUnits", "deletedAt", "createdAt", "updatedAt"
      FROM products
     WHERE id = ANY(${ids}::text[])
     ORDER BY id
       FOR UPDATE`;
  return rows;
}

export interface StockKey {
  productId: string;
  location: StockLocation;
}

export const stockKey = (productId: string, location: StockLocation): string =>
  `${productId}:${location}`;

/**
 * Locks stock balance rows ordered by (productId, location). The product and
 * location lists are crossed (a superset may be locked, never a subset), which
 * keeps one statement per table and the same order for every request. A product
 * that has never moved has no row; it counts as zero available.
 */
export async function lockStockBalances(
  ctx: TxContext,
  keys: readonly StockKey[],
): Promise<Map<string, number>> {
  const ids = [...new Set(keys.map((key) => key.productId))].sort();
  const locations = [...new Set(keys.map((key) => key.location))];
  if (ids.length === 0) {
    return new Map();
  }
  counted(ctx);
  const rows = await ctx.tx.$queryRaw<Array<{ productId: string; location: StockLocation; units: number }>>`
    SELECT "productId", location, "quantityUnits"::int AS units
      FROM stock_balances
     WHERE "productId" = ANY(${ids}::text[])
       AND location = ANY(${locations}::"StockLocation"[])
     ORDER BY "productId", location
       FOR UPDATE`;
  return new Map(rows.map((row) => [stockKey(row.productId, row.location), row.units]));
}

export interface LockedAccount {
  id: string;
  name: string;
  type: "CASH" | "BANK" | "POS";
  isActive: boolean;
  /** From account_balances; a never-used account has no row and counts as zero. */
  balanceKobo: bigint;
}

/**
 * Locks the `account_balances` rows (ordered by accountId) and reads the
 * accounts in the SAME statement. The locking CTE is materialised by Postgres
 * (a CTE with FOR UPDATE is never inlined), so the lock is taken in sorted order.
 */
export async function lockAccounts(
  ctx: TxContext,
  accountIds: readonly string[],
): Promise<Map<string, LockedAccount>> {
  const ids = [...new Set(accountIds)].sort();
  if (ids.length === 0) {
    return new Map();
  }
  counted(ctx);
  const rows = await ctx.tx.$queryRaw<
    Array<{ id: string; name: string; type: LockedAccount["type"]; isActive: boolean; balanceKobo: string }>
  >`
    WITH locked AS (
      SELECT "accountId", "balanceKobo"
        FROM account_balances
       WHERE "accountId" = ANY(${ids}::text[])
       ORDER BY "accountId"
         FOR UPDATE
    )
    SELECT a.id, a.name, a.type::text AS type, a."isActive", COALESCE(l."balanceKobo", 0)::text AS "balanceKobo"
      FROM accounts a
      LEFT JOIN locked l ON l."accountId" = a.id
     WHERE a.id = ANY(${ids}::text[])`;
  return new Map(rows.map((row) => [row.id, { ...row, balanceKobo: BigInt(row.balanceKobo) }]));
}
