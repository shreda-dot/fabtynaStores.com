import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import {
  toStockMovementDto,
  toStockTransferDto,
  toStockTransferLegDto,
  toStockTransferLineDto,
} from "@fabtyna/shared";
import type { StockTransfer, StockTransferDto } from "@fabtyna/shared";
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
import type { ListTransfersQuery } from "./stock.schemas.js";

/**
 * A list row is the public entity itself. The web adapters, the mock adapter
 * and the docs all expect `StockTransferDto[]`, so the query selects exactly
 * the fields of that DTO and runs each row through the same converter the
 * detail endpoint uses. (It previously omitted `createdById`/`createdAt` and
 * added a `lineCount` that the strict DTO schema rejects.)
 */
type TransferListRow = StockTransfer;

export interface TransferListPage {
  items: StockTransferDto[];
  nextCursor: string | null;
  from: string | null;
  to: string | null;
}

export async function listTransfers(
  prisma: PrismaClient,
  query: ListTransfersQuery,
  now: Date,
  maxDateRangeDays: number,
): Promise<TransferListPage> {
  const range = resolveListDateRange(query, now, maxDateRangeDays, {
    defaultToToday: true,
    suppressDefault: query.q !== undefined,
  });
  const conditions: Prisma.Sql[] = [];
  if (range.from !== undefined) {
    conditions.push(Prisma.sql`t."transferredAt" >= ${utcTimestamp(lagosDayStartIso(range.from))}`);
  }
  if (range.to !== undefined) {
    conditions.push(Prisma.sql`t."transferredAt" < ${utcTimestamp(lagosDayStartIso(addOneDay(range.to)))}`);
  }
  if (query.fromLocation !== undefined) {
    conditions.push(Prisma.sql`t."from" = ${query.fromLocation}::"StockLocation"`);
  }
  if (query.toLocation !== undefined) {
    conditions.push(Prisma.sql`t."to" = ${query.toLocation}::"StockLocation"`);
  }
  if (query.q !== undefined) {
    conditions.push(Prisma.sql`t.reference ILIKE ${likePattern(query.q)} ESCAPE '\\'`);
  }
  if (query.cursor !== undefined) {
    const cursor = decodeCursor(query.cursor);
    conditions.push(
      Prisma.sql`(t."transferredAt" < ${utcTimestamp(cursor.at)}
        OR (t."transferredAt" = ${utcTimestamp(cursor.at)} AND t.id < ${cursor.id}))`,
    );
  }
  const where = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
  const rows = await prisma.$queryRaw<TransferListRow[]>`
    SELECT t.id, t."createdById", t.reference, t."from"::text AS "from", t."to"::text AS "to",
           t.reason, t."transferredAt", t."createdAt"
      FROM stock_transfers t
      ${where}
     ORDER BY t."transferredAt" DESC, t.id DESC
     LIMIT ${query.limit + 1}`;
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((row) => toStockTransferDto(row)),
    nextCursor:
      rows.length > query.limit && last !== undefined
        ? encodeCursor({ at: last.transferredAt.toISOString(), id: last.id })
        : null,
    from: range.from ?? null,
    to: range.to ?? null,
  };
}

export async function getTransferDetail(prisma: PrismaClient, id: string) {
  const transfer = await prisma.stockTransfer.findUnique({
    where: { id },
    include: {
      lines: {
        include: {
          product: { select: { name: true } },
          movementLegs: {
            include: {
              stockMovements: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }] },
            },
            orderBy: [{ direction: "asc" }, { id: "asc" }],
          },
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (transfer === null) throw new AppError(404, "NOT_FOUND", "Stock transfer not found.", { id });
  const lines = transfer.lines.map(({ product, movementLegs, ...line }) => ({
    ...toStockTransferLineDto(line),
    productName: product.name,
    legs: movementLegs.map(({ stockMovements: _movements, ...leg }) => toStockTransferLegDto(leg)),
  }));
  const legs = transfer.lines.flatMap((line) =>
    line.movementLegs.map(({ stockMovements: _movements, ...leg }) => toStockTransferLegDto(leg)),
  );
  const movements = transfer.lines.flatMap((line) =>
    line.movementLegs.flatMap((leg) => leg.stockMovements.map(toStockMovementDto)),
  );
  // The Prisma row still carries the `lines` relation; strip it so the strict
  // DTO schema sees only the transfer's own columns.
  const { lines: _lines, ...transferRow } = transfer;
  return { ...toStockTransferDto(transferRow), lines, legs, movements };
}
