import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { decodeCursor, encodeCursor, likePattern } from "../../lib/list-helpers.js";
import type { ListProductsQuery } from "./products.schemas.js";

type ProductListRow = {
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
  isActive: boolean;
  totalUnits: number;
  stockByLocation: Record<string, number> | null;
};

function stockLocations(row: ProductListRow) {
  const locations = row.stockByLocation ?? {};
  const stock = (units: number) => ({
    units,
    packs: Math.floor(units / row.unitsPerPack),
    remainingUnits: units % row.unitsPerPack,
  });
  return {
    WAREHOUSE: stock(locations.WAREHOUSE ?? 0),
    RETAIL_SHELF: stock(locations.RETAIL_SHELF ?? 0),
    MARKET: stock(locations.MARKET ?? 0),
    total: stock(row.totalUnits),
  };
}

export async function listProducts(prisma: PrismaClient, query: ListProductsQuery) {
  const conditions: Prisma.Sql[] = [];
  if (query.active) conditions.push(Prisma.sql`p."deletedAt" IS NULL`);
  else conditions.push(Prisma.sql`p."deletedAt" IS NOT NULL`);
  if (query.category !== undefined) conditions.push(Prisma.sql`p.category = ${query.category}::"ProductCategory"`);
  if (query.saleChannel !== undefined) conditions.push(Prisma.sql`p."saleChannel" = ${query.saleChannel}::"SaleChannel"`);
  if (query.q !== undefined) {
    const pattern = likePattern(query.q);
    conditions.push(Prisma.sql`(p.name ILIKE ${pattern} ESCAPE '\\' OR p.sku ILIKE ${pattern} ESCAPE '\\')`);
  }
  if (query.lowStock === true) conditions.push(Prisma.sql`p."reorderLevelUnits" > 0 AND COALESCE(sb.units, 0) <= p."reorderLevelUnits"`);
  if (query.cursor !== undefined) {
    const cursor = decodeCursor(query.cursor);
    conditions.push(Prisma.sql`(p.name > ${cursor.at} OR (p.name = ${cursor.at} AND p.id > ${cursor.id}))`);
  }
  const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
  const rows = await prisma.$queryRaw<ProductListRow[]>`
    WITH stock AS (
      SELECT "productId", SUM("quantityUnits")::int AS units
        FROM stock_balances
       GROUP BY "productId"
    ),
    filtered AS (
      SELECT p.id, p.name, p.sku, p.category::text AS category, p."packName",
             p."unitsPerPack", p."saleChannel"::text AS "saleChannel",
             p."retailPriceKobo"::text AS "retailPriceKobo",
             p."wholesalePriceKobo"::text AS "wholesalePriceKobo",
             p."averageCostKobo"::text AS "averageCostKobo",
             p."reorderLevelUnits", (p."deletedAt" IS NULL) AS "isActive",
             COALESCE(sb.units, 0)::int AS "totalUnits",
             locations.stock AS "stockByLocation"
        FROM products p
        LEFT JOIN stock sb ON sb."productId" = p.id
        LEFT JOIN LATERAL (
          SELECT jsonb_object_agg(b.location::text, b."quantityUnits") AS stock
            FROM stock_balances b
           WHERE b."productId" = p.id
        ) locations ON TRUE
        ${where}
    )
    SELECT * FROM filtered
     ORDER BY name ASC, id ASC
     LIMIT ${query.limit + 1}`;
  const items = rows.slice(0, query.limit);
  const last = items.at(-1);
  return {
    items: items.map((row) => {
      const { totalUnits: _totalUnits, isActive, ...product } = row;
      return { ...product, active: isActive, stock: stockLocations(row) };
    }),
    nextCursor: rows.length > query.limit && last
      ? encodeCursor({ at: last.name, id: last.id })
      : null,
  };
}

export async function getProductDetail(prisma: PrismaClient, id: string) {
  const product = await prisma.product.findUnique({ where: { id } });
  if (product === null) throw new AppError(404, "NOT_FOUND", "Product not found.", { id });
  const [balances, movements] = await Promise.all([
    prisma.stockBalance.findMany({ where: { productId: id }, orderBy: { location: "asc" } }),
    prisma.$queryRaw<Array<{
      id: string;
      type: string;
      location: string;
      quantityUnits: number;
      occurredAt: Date;
      reference: string | null;
    }>>`
      SELECT sm.id, sm.type::text AS type, sm.location::text AS location,
             sm."quantityUnits", sm."occurredAt",
             COALESCE(p.reference, s.reference, st.reference, sa.id) AS reference
        FROM stock_movements sm
        LEFT JOIN purchase_lines pl ON pl.id = sm."purchaseLineId"
        LEFT JOIN purchases p ON p.id = pl."purchaseId"
        LEFT JOIN sale_lines sl ON sl.id = sm."saleLineId"
        LEFT JOIN sales s ON s.id = sl."saleId"
        LEFT JOIN stock_transfer_legs leg ON leg.id = sm."transferLegId"
        LEFT JOIN stock_transfer_lines tl ON tl.id = leg."transferLineId"
        LEFT JOIN stock_transfers st ON st.id = tl."transferId"
        LEFT JOIN stock_adjustment_lines al ON al.id = sm."adjustmentLineId"
        LEFT JOIN stock_adjustments sa ON sa.id = al."adjustmentId"
       WHERE sm."productId" = ${id}
       ORDER BY sm."occurredAt" DESC, sm.id DESC
       LIMIT 20`,
  ]);
  return {
    ...product,
    retailPriceKobo: product.retailPriceKobo.toString(),
    wholesalePriceKobo: product.wholesalePriceKobo.toString(),
    averageCostKobo: product.averageCostKobo.toString(),
    active: product.deletedAt === null,
    deletedAt: product.deletedAt?.toISOString() ?? null,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
    stock: (["WAREHOUSE", "RETAIL_SHELF", "MARKET"] as const).map((location) => {
      const units = balances.find((balance) => balance.location === location)?.quantityUnits ?? 0;
      return {
        location,
        units,
        packs: Math.floor(units / product.unitsPerPack),
        remainingUnits: units % product.unitsPerPack,
      };
    }),
    movements: movements.map((movement) => ({ ...movement, occurredAt: movement.occurredAt.toISOString() })),
  };
}
