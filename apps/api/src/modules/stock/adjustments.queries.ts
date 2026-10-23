import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import {
  toStockAdjustmentDto,
  toStockAdjustmentLineDto,
  toStockMovementDto,
} from "@fabtyna/shared";
import type { StockAdjustment } from "@fabtyna/shared";
import { AppError } from "../../lib/errors.js";
import {
  addOneDay,
  decodeCursor,
  encodeCursor,
  lagosDayStartIso,
  likePattern,
  resolveListDateRange,
  utcTimestamp,
} from "../../lib/list-helpers.js";
import type { ListAdjustmentsQuery } from "./stock.schemas.js";

/**
 * A list row is the public entity `StockAdjustmentDto` itself, as the web and
 * mock adapters expect. (It previously omitted `createdById`/`createdAt` and
 * added a `lineCount` that the strict DTO schema rejects.)
 */
type AdjustmentListRow = StockAdjustment;

export async function listAdjustments(
  prisma: PrismaClient,
  query: ListAdjustmentsQuery,
  now: Date,
  maxDateRangeDays: number,
) {
  const range = resolveListDateRange(query, now, maxDateRangeDays, {
    defaultToToday: true,
    suppressDefault: query.q !== undefined,
  });
  const conditions: Prisma.Sql[] = [];
  if (range.from !== undefined) {
    conditions.push(Prisma.sql`a."adjustedAt" >= ${utcTimestamp(lagosDayStartIso(range.from))}`);
  }
  if (range.to !== undefined) {
    conditions.push(Prisma.sql`a."adjustedAt" < ${utcTimestamp(lagosDayStartIso(addOneDay(range.to)))}`);
  }
  if (query.status !== undefined) {
    conditions.push(Prisma.sql`a.status = ${query.status}::"StockAdjustmentStatus"`);
  }
  if (query.location !== undefined) {
    conditions.push(
      Prisma.sql`EXISTS (
        SELECT 1 FROM stock_adjustment_lines al
         WHERE al."adjustmentId" = a.id AND al.location = ${query.location}::"StockLocation"
      )`,
    );
  }
  if (query.q !== undefined) {
    const pattern = likePattern(query.q);
    conditions.push(
      Prisma.sql`(a.reason ILIKE ${pattern} ESCAPE '\\' OR EXISTS (
        SELECT 1 FROM stock_adjustment_lines al
        JOIN products p ON p.id = al."productId"
        WHERE al."adjustmentId" = a.id AND p.name ILIKE ${pattern} ESCAPE '\\'
      ))`,
    );
  }
  if (query.cursor !== undefined) {
    const cursor = decodeCursor(query.cursor);
    conditions.push(
      Prisma.sql`(a."adjustedAt" < ${utcTimestamp(cursor.at)}
        OR (a."adjustedAt" = ${utcTimestamp(cursor.at)} AND a.id < ${cursor.id}))`,
    );
  }
  const where = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
  const rows = await prisma.$queryRaw<AdjustmentListRow[]>`
    SELECT a.id, a."createdById", a.reason, a.status::text AS status, a."adjustedAt", a."createdAt"
      FROM stock_adjustments a
      ${where}
     ORDER BY a."adjustedAt" DESC, a.id DESC
     LIMIT ${query.limit + 1}`;
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((row) => toStockAdjustmentDto(row)),
    nextCursor:
      rows.length > query.limit && last !== undefined
        ? encodeCursor({ at: last.adjustedAt.toISOString(), id: last.id })
        : null,
    from: range.from ?? null,
    to: range.to ?? null,
  };
}

export async function getAdjustmentDetail(prisma: PrismaClient, id: string) {
  const adjustment = await prisma.stockAdjustment.findUnique({
    where: { id },
    include: {
      lines: {
        include: {
          product: { select: { name: true } },
          stockMovements: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }] },
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (adjustment === null) throw new AppError(404, "NOT_FOUND", "Stock adjustment not found.", { id });
  const lines = adjustment.lines.map(({ product, stockMovements: _movements, ...line }) => ({
    ...toStockAdjustmentLineDto(line),
    productName: product.name,
  }));
  const movements = adjustment.lines.flatMap((line) => line.stockMovements.map(toStockMovementDto));
  // The Prisma row still carries the `lines` relation; strip it so the strict
  // DTO schema sees only the adjustment's own columns.
  const { lines: _lines, ...adjustmentRow } = adjustment;
  return { ...toStockAdjustmentDto(adjustmentRow), lines, movements };
}
