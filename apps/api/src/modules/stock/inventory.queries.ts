import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import {
  calculateStockUnits,
  isLowStock,
  splitStockIntoPacks,
  stockWorthAtCost,
  stockWorthAtRetail,
  stockWorthAtWholesale,
  stockValueKobo,
  type StockMovement,
} from "@fabtyna/shared";
import { decodeCursor, encodeCursor, likePattern } from "../../lib/list-helpers.js";
import type { InventoryQuery, LowStockQuery } from "./inventory.schemas.js";

type InventoryRow = {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  packName: string;
  unitsPerPack: number;
  saleChannel: string;
  retailPriceKobo: string;
  wholesalePriceKobo: string;
  averageCostKobo: string;
  reorderLevelUnits: number;
  active: boolean;
  totalUnits: number;
  locations: Record<string, number> | null;
};

function asMovements(productId: string, locations: Record<string, number> | null): StockMovement[] {
  return Object.entries(locations ?? {}).map(([location, quantityUnits]) => ({
    id: `${productId}:${location}`,
    productId,
    location: location as StockMovement["location"],
    type: "PURCHASE",
    quantityUnits,
    unitCostKobo: 0n,
    purchaseLineId: null,
    saleLineId: null,
    transferLegId: null,
    adjustmentLineId: null,
    returnLineId: null,
    reversesEntryId: null,
    occurredAt: new Date(0),
    createdAt: new Date(0),
  }));
}

export async function listInventory(prisma: PrismaClient, query: InventoryQuery) {
  const conditions: Prisma.Sql[] = [];
  if (query.q !== undefined) {
    const pattern = likePattern(query.q);
    conditions.push(Prisma.sql`(p.name ILIKE ${pattern} ESCAPE '\\' OR p.sku ILIKE ${pattern} ESCAPE '\\')`);
  }
  const baseWhere = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
  const nonzeroCondition = query.nonZero ? Prisma.sql`AND COALESCE(base."totalUnits", 0) > 0` : Prisma.empty;
  const cursorCondition = query.cursor === undefined
    ? Prisma.empty
    : (() => {
        const cursor = decodeCursor(query.cursor!);
        return Prisma.sql`AND (base.name > ${cursor.at} OR (base.name = ${cursor.at} AND base.id > ${cursor.id}))`;
      })();
  const rows = await prisma.$queryRaw<InventoryRow[]>`
    WITH selected_balances AS (
      SELECT "productId", location, "quantityUnits"
        FROM stock_balances b
       ${query.location === undefined ? Prisma.empty : Prisma.sql`WHERE b.location = ${query.location}::"StockLocation"`}
    ),
    sums AS (
      SELECT "productId", SUM("quantityUnits")::int AS units
        FROM selected_balances GROUP BY "productId"
    ),
    base AS (
      SELECT p.id, p.name, p.sku, p.category::text AS category, p."packName",
             p."unitsPerPack", p."saleChannel"::text AS "saleChannel",
             p."retailPriceKobo"::text AS "retailPriceKobo",
             p."wholesalePriceKobo"::text AS "wholesalePriceKobo",
             p."averageCostKobo"::text AS "averageCostKobo", p."reorderLevelUnits",
             (p."deletedAt" IS NULL) AS active, COALESCE(s.units, 0)::int AS "totalUnits",
             loc.locations
        FROM products p
        LEFT JOIN sums s ON s."productId" = p.id
        LEFT JOIN LATERAL (
          SELECT jsonb_object_agg(sb.location::text, sb."quantityUnits") AS locations
            FROM selected_balances sb WHERE sb."productId" = p.id
        ) loc ON TRUE
        ${baseWhere}
        GROUP BY p.id, p.name, p.sku, p.category, p."packName", p."unitsPerPack",
                 p."saleChannel", p."retailPriceKobo", p."wholesalePriceKobo",
                 p."averageCostKobo", p."reorderLevelUnits", p."deletedAt", s.units, loc.locations
    )
    SELECT base.* FROM base
      WHERE TRUE ${query.active ? Prisma.sql`AND active` : Prisma.sql`AND NOT active`}
        ${nonzeroCondition}
        ${cursorCondition}
     ORDER BY name ASC, id ASC
     LIMIT ${query.limit + 1}`;

  const totalsConditions: Prisma.Sql[] = [];
  if (query.q !== undefined) {
    const pattern = likePattern(query.q);
    totalsConditions.push(Prisma.sql`(p.name ILIKE ${pattern} ESCAPE '\\' OR p.sku ILIKE ${pattern} ESCAPE '\\')`);
  }
  if (query.nonZero) totalsConditions.push(Prisma.sql`COALESCE(s.units, 0) > 0`);
  const totalsWhere = totalsConditions.length
    ? Prisma.sql`WHERE ${Prisma.join(totalsConditions, " AND ")}`
    : Prisma.empty;
  const totalRows = await prisma.$queryRaw<Array<{
    units: number;
    unitsPerPack: number;
    averageCostKobo: bigint;
    retailPriceKobo: bigint;
    wholesalePriceKobo: bigint;
  }>>`
    WITH selected_balances AS (
      SELECT "productId", location, "quantityUnits"
        FROM stock_balances b
       ${query.location === undefined ? Prisma.empty : Prisma.sql`WHERE b.location = ${query.location}::"StockLocation"`}
    ),
    sums AS (
      SELECT "productId", SUM("quantityUnits")::int AS units
        FROM selected_balances GROUP BY "productId"
    )
    SELECT COALESCE(s.units, 0)::int AS units, p."unitsPerPack", p."averageCostKobo",
           p."retailPriceKobo", p."wholesalePriceKobo"
      FROM products p
      LEFT JOIN sums s ON s."productId" = p.id
     ${totalsWhere}`;
  const totals = totalRows.reduce((result, row) => {
    const quantities = { WAREHOUSE: row.units };
    result.units += BigInt(row.units);
    result.cost += stockValueKobo(quantities, row, "ALL", "COST");
    result.retail += stockValueKobo(quantities, row, "ALL", "RETAIL");
    result.wholesale += stockValueKobo(quantities, row, "ALL", "WHOLESALE");
    return result;
  }, { units: 0n, cost: 0n, retail: 0n, wholesale: 0n });

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => {
      const movements = asMovements(row.id, row.locations);
      const product = {
        id: row.id,
        averageCostKobo: BigInt(row.averageCostKobo),
        retailPriceKobo: BigInt(row.retailPriceKobo),
        wholesalePriceKobo: BigInt(row.wholesalePriceKobo),
        unitsPerPack: row.unitsPerPack,
      };
      const totalUnits = calculateStockUnits(movements);
      return {
        ...row,
        totalUnits,
        stock: Object.fromEntries(
          ["WAREHOUSE", "RETAIL_SHELF", "MARKET"].map((location) => {
            const units = row.locations?.[location] ?? 0;
            return [location, { units, ...splitStockIntoPacks(units, row.unitsPerPack) }];
          }),
        ),
        worthAtCostKobo: stockWorthAtCost(movements, product).toString(),
        worthAtRetailKobo: stockWorthAtRetail(movements, product).toString(),
        worthAtWholesaleKobo: stockWorthAtWholesale(movements, product).toString(),
        lowStock: isLowStock(movements, { id: row.id, reorderLevelUnits: row.reorderLevelUnits }) &&
          row.reorderLevelUnits > 0,
      };
    }),
    nextCursor: rows.length > query.limit && last
      ? encodeCursor({ at: last.name, id: last.id })
      : null,
    totals: {
      units: totals.units.toString(),
      worthAtCostKobo: totals.cost.toString(),
      worthAtRetailKobo: totals.retail.toString(),
      worthAtWholesaleKobo: totals.wholesale.toString(),
      includeInactiveProducts: true,
    },
  };
}

export async function listLowStock(prisma: PrismaClient, query: LowStockQuery) {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`p."reorderLevelUnits" > 0`,
    Prisma.sql`COALESCE(sb.units, 0) <= p."reorderLevelUnits"`,
  ];
  if (query.active) conditions.push(Prisma.sql`p."deletedAt" IS NULL`);
  else conditions.push(Prisma.sql`p."deletedAt" IS NOT NULL`);
  if (query.q !== undefined) {
    const pattern = likePattern(query.q);
    conditions.push(Prisma.sql`(p.name ILIKE ${pattern} ESCAPE '\\' OR p.sku ILIKE ${pattern} ESCAPE '\\')`);
  }
  if (query.cursor !== undefined) {
    const cursor = decodeCursor(query.cursor);
    conditions.push(Prisma.sql`(p.name > ${cursor.at} OR (p.name = ${cursor.at} AND p.id > ${cursor.id}))`);
  }
  const where = Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;
  const rows = await prisma.$queryRaw<Array<{
    id: string; name: string; sku: string | null; reorderLevelUnits: number; units: number;
  }>>`
    WITH stock AS (
      SELECT "productId", SUM("quantityUnits")::int AS units
        FROM stock_balances
       ${query.location === undefined ? Prisma.empty : Prisma.sql`WHERE location = ${query.location}::"StockLocation"`}
       GROUP BY "productId"
    )
    SELECT p.id, p.name, p.sku, p."reorderLevelUnits", COALESCE(sb.units, 0)::int AS units
      FROM products p LEFT JOIN stock sb ON sb."productId" = p.id
      ${where}
     ORDER BY p.name, p.id
     LIMIT ${query.limit + 1}`;
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({ ...row, shortfallUnits: row.reorderLevelUnits - row.units })),
    nextCursor: rows.length > query.limit && last ? encodeCursor({ at: last.name, id: last.id }) : null,
  };
}
