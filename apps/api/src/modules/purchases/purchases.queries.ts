import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import { getLagosBusinessDate, toPurchaseDto, toPurchaseLineDto, toSupplierPaymentDto } from "@fabtyna/shared";
import { AppError } from "../../lib/errors.js";
import {
  addOneDay,
  decodeCursor,
  encodeCursor,
  lagosDayStartIso,
  likePattern,
  utcTimestamp,
} from "../../lib/list-helpers.js";
import type { ListPurchasesQuery } from "./purchases.schemas.js";

/**
 * Read side of the purchases module. Reads need no locks and no transaction.
 */

interface ListRow {
  id: string;
  reference: string | null;
  purchasedAt: Date;
  status: string;
  supplierId: string | null;
  supplierName: string | null;
  lineCount: number;
  totalKobo: string;
  paidKobo: string;
  balanceDueKobo: string;
  dueDate: string | null;
}

export interface PurchaseListItem {
  id: string;
  reference: string | null;
  purchasedAt: string;
  status: string;
  supplierId: string | null;
  supplierName: string | null;
  lineCount: number;
  totalKobo: string;
  paidKobo: string;
  /** What is still owed. A VOIDED purchase owes nothing. */
  balanceDueKobo: string;
  dueDate: string | null;
}

export interface PurchaseListPage {
  items: PurchaseListItem[];
  nextCursor: string | null;
}

/**
 * Newest first: ORDER BY purchasedAt DESC, id DESC, paged by a keyset cursor on
 * that pair, so a page boundary can neither repeat nor skip a row.
 */
export async function listPurchases(
  prisma: PrismaClient,
  query: ListPurchasesQuery,
  now: Date,
): Promise<PurchaseListPage> {
  const conditions: Prisma.Sql[] = [];

  if (query.from !== undefined) {
    conditions.push(Prisma.sql`p."purchasedAt" >= ${utcTimestamp(lagosDayStartIso(query.from))}`);
  }
  if (query.to !== undefined) {
    conditions.push(Prisma.sql`p."purchasedAt" < ${utcTimestamp(lagosDayStartIso(addOneDay(query.to)))}`);
  }
  if (query.supplierId !== undefined) {
    conditions.push(Prisma.sql`p."supplierId" = ${query.supplierId}`);
  }
  if (query.status !== undefined) {
    conditions.push(Prisma.sql`p.status = ${query.status}::"PurchaseStatus"`);
  }
  if (query.unpaid === true) {
    conditions.push(Prisma.sql`p."totalKobo" > p."paidKobo" AND p.status <> 'VOIDED'`);
  }
  if (query.overdue === true) {
    // dueDate is a Lagos business date string, so it compares with today's Lagos date as text.
    conditions.push(
      Prisma.sql`p."dueDate" < ${getLagosBusinessDate(now)} AND p."totalKobo" > p."paidKobo" AND p.status <> 'VOIDED'`,
    );
  }
  if (query.q !== undefined) {
    const pattern = likePattern(query.q);
    conditions.push(
      Prisma.sql`(p.reference ILIKE ${pattern} ESCAPE '\\' OR s.name ILIKE ${pattern} ESCAPE '\\')`,
    );
  }
  if (query.cursor !== undefined) {
    const cursor = decodeCursor(query.cursor);
    conditions.push(
      Prisma.sql`(p."purchasedAt" < ${utcTimestamp(cursor.at)}
                  OR (p."purchasedAt" = ${utcTimestamp(cursor.at)} AND p.id < ${cursor.id}))`,
    );
  }

  const where = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;

  const rows = await prisma.$queryRaw<ListRow[]>`
    SELECT p.id, p.reference, p."purchasedAt", p.status::text AS status,
           p."supplierId", s.name AS "supplierName",
           (SELECT count(*)::int FROM purchase_lines pl WHERE pl."purchaseId" = p.id) AS "lineCount",
           p."totalKobo"::text AS "totalKobo", p."paidKobo"::text AS "paidKobo",
           (CASE WHEN p.status = 'VOIDED' THEN 0 ELSE GREATEST(p."totalKobo" - p."paidKobo", 0) END)::text
             AS "balanceDueKobo",
           p."dueDate"
      FROM purchases p
      LEFT JOIN suppliers s ON s.id = p."supplierId"
      ${where}
     ORDER BY p."purchasedAt" DESC, p.id DESC
     LIMIT ${query.limit + 1}`;

  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > query.limit && last !== undefined
      ? encodeCursor({ at: last.purchasedAt.toISOString(), id: last.id })
      : null;

  return {
    items: page.map((row) => ({ ...row, purchasedAt: row.purchasedAt.toISOString() })),
    nextCursor,
  };
}

/**
 * The purchase with its supplier, lines (product name and unit), supplier
 * payments (account name and a `reversed` flag derived from the account
 * ledger) and the purchase's money entries (supplier ledger and account ledger).
 */
export async function getPurchaseDetail(prisma: PrismaClient, id: string) {
  const purchase = await prisma.purchase.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true, phone: true, deletedAt: true } },
      lines: { include: { product: { select: { name: true } } }, orderBy: { id: "asc" } },
      payments: { include: { account: { select: { name: true } } }, orderBy: [{ paidAt: "asc" }, { id: "asc" }] },
    },
  });
  if (purchase === null) {
    throw new AppError(404, "NOT_FOUND", "Purchase not found.", { id });
  }

  const paymentIds = purchase.payments.map((payment) => payment.id);
  const related = [{ purchaseId: id }, ...(paymentIds.length > 0 ? [{ supplierPaymentId: { in: paymentIds } }] : [])];
  const [supplierLedger, accountLedger] = await Promise.all([
    prisma.supplierLedgerEntry.findMany({ where: { OR: related }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] }),
    prisma.accountLedgerEntry.findMany({
      where: { OR: related },
      include: { account: { select: { name: true } } },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    }),
  ]);

  const reversedPaymentIds = new Set(
    accountLedger
      .filter((entry) => entry.reversesEntryId !== null && entry.supplierPaymentId !== null)
      .map((entry) => entry.supplierPaymentId as string),
  );

  const { supplier, lines, payments, ...purchaseRow } = purchase;
  const dto = toPurchaseDto(purchaseRow);
  const balanceDue =
    purchaseRow.status === "VOIDED" || purchaseRow.totalKobo <= purchaseRow.paidKobo
      ? 0n
      : purchaseRow.totalKobo - purchaseRow.paidKobo;

  return {
    ...dto,
    balanceDueKobo: balanceDue.toString(),
    livePaymentsKobo: payments
      .filter((payment) => !reversedPaymentIds.has(payment.id))
      .reduce((sum, payment) => sum + payment.amountKobo, 0n)
      .toString(),
    supplier:
      supplier === null
        ? null
        : { id: supplier.id, name: supplier.name, phone: supplier.phone, isActive: supplier.deletedAt === null },
    lines: lines.map(({ product, ...line }) => ({
      ...toPurchaseLineDto({ ...line, quantity: Number(line.quantity) }),
      productName: product.name,
    })),
    payments: payments.map(({ account, ...payment }) => ({
      ...toSupplierPaymentDto(payment),
      accountName: account.name,
      reversed: reversedPaymentIds.has(payment.id),
    })),
    moneyEntries: {
      supplierLedger: supplierLedger.map((entry) => ({
        id: entry.id,
        type: entry.type,
        amountKobo: entry.amountKobo.toString(),
        reversesEntryId: entry.reversesEntryId,
        occurredAt: entry.occurredAt.toISOString(),
      })),
      account: accountLedger.map(({ account, ...entry }) => ({
        id: entry.id,
        accountId: entry.accountId,
        accountName: account.name,
        type: entry.type,
        amountKobo: entry.amountKobo.toString(),
        reversesEntryId: entry.reversesEntryId,
        occurredAt: entry.occurredAt.toISOString(),
      })),
    },
  };
}
