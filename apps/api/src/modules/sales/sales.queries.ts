import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import { toSaleDto, toSaleLineDto, toSalePaymentDto } from "@fabtyna/shared";
import { AppError, validationError } from "../../lib/errors.js";
import type { ListSalesQuery } from "./sales.schemas.js";

/**
 * Read side of the sales module. Reads need no locks and no transaction: each
 * is one statement (or a small fixed number) against committed data.
 */

const LAGOS_OFFSET = "+01:00"; // Africa/Lagos has no daylight saving time.

/** First instant of a Lagos business date, as a UTC ISO string. */
function lagosDayStartIso(date: string): string {
  return new Date(`${date}T00:00:00${LAGOS_OFFSET}`).toISOString();
}

function addOneDay(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/** `timestamp without time zone` columns hold UTC; compare against a UTC literal. */
const utcTimestamp = (iso: string): Prisma.Sql => Prisma.sql`(${iso}::timestamptz AT TIME ZONE 'UTC')`;

interface Cursor {
  soldAt: string;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<Cursor>;
    if (
      typeof parsed.soldAt === "string" &&
      typeof parsed.id === "string" &&
      !Number.isNaN(new Date(parsed.soldAt).getTime())
    ) {
      return { soldAt: new Date(parsed.soldAt).toISOString(), id: parsed.id };
    }
  } catch {
    // fall through to the error below
  }
  throw validationError("The cursor is not valid.", { field: "cursor" });
}

/** Escapes `%`, `_` and `\` so a search term is matched literally. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

interface ListRow {
  id: string;
  reference: string | null;
  soldAt: Date;
  channel: string;
  status: string;
  customerId: string | null;
  customerName: string | null;
  lineCount: number;
  totalKobo: string;
  paidKobo: string;
  balanceDueKobo: string;
}

export interface SaleListItem {
  id: string;
  reference: string | null;
  soldAt: string;
  channel: string;
  status: string;
  customerId: string | null;
  customerName: string | null;
  lineCount: number;
  totalKobo: string;
  paidKobo: string;
  /** What is still owed. A VOIDED sale owes nothing. */
  balanceDueKobo: string;
}

export interface SaleListPage {
  items: SaleListItem[];
  nextCursor: string | null;
}

/**
 * Newest first: ORDER BY soldAt DESC, id DESC, paged by a keyset cursor on that
 * same pair, so a page boundary can neither repeat nor skip a row even when
 * several sales share a timestamp.
 */
export async function listSales(prisma: PrismaClient, query: ListSalesQuery): Promise<SaleListPage> {
  const conditions: Prisma.Sql[] = [];

  if (query.from !== undefined) {
    conditions.push(Prisma.sql`s."soldAt" >= ${utcTimestamp(lagosDayStartIso(query.from))}`);
  }
  if (query.to !== undefined) {
    conditions.push(Prisma.sql`s."soldAt" < ${utcTimestamp(lagosDayStartIso(addOneDay(query.to)))}`);
  }
  if (query.status !== undefined) {
    conditions.push(Prisma.sql`s.status = ${query.status}::"SaleStatus"`);
  }
  if (query.channel !== undefined) {
    conditions.push(Prisma.sql`s.channel = ${query.channel}::"SaleChannel"`);
  }
  if (query.customerId !== undefined) {
    conditions.push(Prisma.sql`s."customerId" = ${query.customerId}`);
  }
  if (query.unpaid === true) {
    conditions.push(Prisma.sql`s."totalKobo" > s."paidKobo" AND s.status <> 'VOIDED'`);
  }
  if (query.q !== undefined) {
    const pattern = likePattern(query.q);
    conditions.push(
      Prisma.sql`(s.reference ILIKE ${pattern} ESCAPE '\\' OR c.name ILIKE ${pattern} ESCAPE '\\')`,
    );
  }
  if (query.cursor !== undefined) {
    const cursor = decodeCursor(query.cursor);
    conditions.push(
      Prisma.sql`(s."soldAt" < ${utcTimestamp(cursor.soldAt)}
                  OR (s."soldAt" = ${utcTimestamp(cursor.soldAt)} AND s.id < ${cursor.id}))`,
    );
  }

  const where = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;

  const rows = await prisma.$queryRaw<ListRow[]>`
    SELECT s.id, s.reference, s."soldAt", s.channel::text AS channel, s.status::text AS status,
           s."customerId", COALESCE(c.name, s."customerName") AS "customerName",
           (SELECT count(*)::int FROM sale_lines sl WHERE sl."saleId" = s.id) AS "lineCount",
           s."totalKobo"::text AS "totalKobo", s."paidKobo"::text AS "paidKobo",
           (CASE WHEN s.status = 'VOIDED' THEN 0 ELSE GREATEST(s."totalKobo" - s."paidKobo", 0) END)::text
             AS "balanceDueKobo"
      FROM sales s
      LEFT JOIN customers c ON c.id = s."customerId"
      ${where}
     ORDER BY s."soldAt" DESC, s.id DESC
     LIMIT ${query.limit + 1}`;

  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > query.limit && last !== undefined
      ? encodeCursor({ soldAt: last.soldAt.toISOString(), id: last.id })
      : null;

  return {
    items: page.map((row) => ({ ...row, soldAt: row.soldAt.toISOString() })),
    nextCursor,
  };
}

/**
 * The sale with its customer, lines (product name and unit) and payments (account
 * name, and a `reversed` flag derived from the account ledger: a payment is
 * reversed once a reversal entry points at its account entry).
 */
export async function getSaleDetail(prisma: PrismaClient, id: string) {
  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, type: true, phone: true, deletedAt: true } },
      lines: { include: { product: { select: { name: true } } }, orderBy: { id: "asc" } },
      payments: { include: { account: { select: { name: true } } }, orderBy: [{ paidAt: "asc" }, { id: "asc" }] },
    },
  });
  if (sale === null) {
    throw new AppError(404, "NOT_FOUND", "Sale not found.", { id });
  }

  const paymentIds = sale.payments.map((payment) => payment.id);
  const reversedPaymentIds = new Set<string>();
  if (paymentIds.length > 0) {
    const reversals = await prisma.accountLedgerEntry.findMany({
      where: { salePaymentId: { in: paymentIds }, reversesEntryId: { not: null } },
      select: { salePaymentId: true },
    });
    for (const reversal of reversals) {
      if (reversal.salePaymentId !== null) {
        reversedPaymentIds.add(reversal.salePaymentId);
      }
    }
  }

  const { customer, lines, payments, ...saleRow } = sale;
  const dto = toSaleDto(saleRow);
  const balanceDue =
    saleRow.status === "VOIDED" || saleRow.totalKobo <= saleRow.paidKobo ? 0n : saleRow.totalKobo - saleRow.paidKobo;

  return {
    ...dto,
    balanceDueKobo: balanceDue.toString(),
    customer:
      customer === null
        ? null
        : {
            id: customer.id,
            name: customer.name,
            type: customer.type,
            phone: customer.phone,
            isActive: customer.deletedAt === null,
          },
    lines: lines.map(({ product, location, costPerUnitKobo: _cost, ...line }) => ({
      ...toSaleLineDto({ ...line, quantity: Number(line.quantity) }),
      productName: product.name,
      location,
    })),
    payments: payments.map(({ account, ...payment }) => ({
      ...toSalePaymentDto(payment),
      accountName: account.name,
      reversed: reversedPaymentIds.has(payment.id),
    })),
  };
}
