import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { decodeCursor, encodeCursor, likePattern, utcTimestamp } from "../../lib/list-helpers.js";
import type { ListLoansQuery } from "./loans.schemas.js";

interface LoanListRow {
  id: string;
  lenderName: string;
  principalKobo: string;
  chargesKobo: string;
  totalToRepayKobo: string;
  repaidKobo: string;
  outstandingKobo: string;
  dueDate: string | null;
  disbursedAt: Date;
  status: "ACTIVE" | "PAID" | "OVERDUE";
}

export async function listLoans(
  prisma: PrismaClient,
  query: ListLoansQuery,
  todayLagosDate: string,
) {
  const conditions: Prisma.Sql[] = [];

  if (query.q !== undefined) {
    const pattern = likePattern(query.q);
    conditions.push(Prisma.sql`l."lenderName" ILIKE ${pattern} ESCAPE '\\'`);
  }
  if (query.dueBefore !== undefined) {
    conditions.push(Prisma.sql`l."dueDate" IS NOT NULL AND l."dueDate" <= ${query.dueBefore}`);
  }
  if (query.cursor !== undefined) {
    const cursor = decodeCursor(query.cursor);
    conditions.push(
      Prisma.sql`(l."disbursedAt" < ${utcTimestamp(cursor.at)}
        OR (l."disbursedAt" = ${utcTimestamp(cursor.at)} AND l.id < ${cursor.id}))`,
    );
  }

  const where = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
  const statusFilter = query.status
    ? Prisma.sql`WHERE status = ${query.status}`
    : Prisma.sql`WHERE status <> 'PAID'`;

  const rows = await prisma.$queryRaw<LoanListRow[]>`
    WITH loan_totals AS (
      SELECT l.id,
             l."lenderName",
             l."principalKobo"::text AS "principalKobo",
             l."dueDate",
             l."disbursedAt",
             COALESCE(SUM(CASE WHEN le.type = 'CHARGE' THEN le."amountKobo" ELSE 0 END), 0)::text AS "chargesKobo",
             COALESCE(SUM(CASE WHEN le.type = 'REPAYMENT' THEN -le."amountKobo" ELSE 0 END), 0)::text AS "repaidKobo",
             COALESCE(SUM(le."amountKobo"), 0)::text AS "outstandingKobo",
             (l."principalKobo" + COALESCE(SUM(CASE WHEN le.type = 'CHARGE' THEN le."amountKobo" ELSE 0 END), 0))::text
               AS "totalToRepayKobo"
        FROM loans l
        LEFT JOIN loan_ledger_entries le ON le."loanId" = l.id
        ${where}
       GROUP BY l.id
    ),
    shaped AS (
      SELECT *,
             CASE
               WHEN "outstandingKobo"::bigint <= 0 THEN 'PAID'
               WHEN "dueDate" IS NOT NULL AND "dueDate" < ${todayLagosDate} THEN 'OVERDUE'
               ELSE 'ACTIVE'
             END AS status
        FROM loan_totals
    )
    SELECT id, "lenderName", "principalKobo", "chargesKobo", "totalToRepayKobo", "repaidKobo", "outstandingKobo",
           "dueDate", "disbursedAt", status::text AS status
      FROM shaped
      ${statusFilter}
     ORDER BY "disbursedAt" DESC, id DESC
     LIMIT ${query.limit + 1}`;

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      id: row.id,
      lenderName: row.lenderName,
      principalKobo: row.principalKobo,
      chargesKobo: row.chargesKobo,
      totalToRepayKobo: row.totalToRepayKobo,
      repaidKobo: row.repaidKobo,
      outstandingKobo: row.outstandingKobo,
      dueDate: row.dueDate,
      disbursedAt: row.disbursedAt.toISOString(),
      status: row.status,
    })),
    nextCursor:
      rows.length > query.limit && last !== undefined
        ? encodeCursor({ at: last.disbursedAt.toISOString(), id: last.id })
        : null,
  };
}

export async function getLoanDetail(prisma: PrismaClient, loanId: string, todayLagosDate: string) {
  const loan = await prisma.loan.findUnique({ where: { id: loanId } });
  if (loan === null) {
    throw new AppError(404, "NOT_FOUND", "Loan not found.", { id: loanId });
  }

  const [ledgerEntries, repayments] = await Promise.all([
    prisma.loanLedgerEntry.findMany({
      where: { loanId },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    }),
    prisma.loanRepayment.findMany({
      where: { loanId },
      orderBy: [{ paidAt: "asc" }, { id: "asc" }],
    }),
  ]);
  const repaymentIds = repayments.map((repayment) => repayment.id);
  const accountEntries =
    repaymentIds.length === 0
      ? []
      : await prisma.accountLedgerEntry.findMany({
          where: { loanRepaymentId: { in: repaymentIds } },
          include: { account: { select: { name: true } } },
          orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        });

  const chargeIds = new Set(
    ledgerEntries.filter((entry) => entry.type === "CHARGE").map((entry) => entry.id),
  );
  const reversedChargeIds = new Set(
    ledgerEntries
      .filter((entry) => entry.reversesEntryId !== null && entry.reversesEntryId !== undefined)
      .map((entry) => entry.reversesEntryId as string)
      .filter((id) => chargeIds.has(id)),
  );

  const reversedRepaymentIds = new Set(
    accountEntries
      .filter((entry) => entry.reversesEntryId !== null && entry.loanRepaymentId !== null)
      .map((entry) => entry.loanRepaymentId as string),
  );
  const originalRepaymentEntries = accountEntries.filter(
    (entry) => entry.type === "LOAN_REPAYMENT" && entry.reversesEntryId === null,
  );
  const accountEntryByRepayment = new Map(originalRepaymentEntries.map((entry) => [entry.loanRepaymentId as string, entry]));

  const chargesKobo = ledgerEntries
    .filter((entry) => entry.type === "CHARGE")
    .reduce((sum, entry) => sum + entry.amountKobo, 0n);
  const outstandingKobo = ledgerEntries.reduce((sum, entry) => sum + entry.amountKobo, 0n);
  const repaidKobo = repayments.reduce(
    (sum, repayment) => sum + (reversedRepaymentIds.has(repayment.id) ? 0n : repayment.amountKobo),
    0n,
  );
  const totalToRepayKobo = loan.principalKobo + chargesKobo;
  const status: "ACTIVE" | "PAID" | "OVERDUE" =
    outstandingKobo <= 0n
      ? "PAID"
      : loan.dueDate !== null && loan.dueDate < todayLagosDate
        ? "OVERDUE"
        : "ACTIVE";

  return {
    summary: {
      id: loan.id,
      lenderName: loan.lenderName,
      principalKobo: loan.principalKobo.toString(),
      agreedInterestKobo: loan.agreedInterestKobo.toString(),
      disbursedAt: loan.disbursedAt.toISOString(),
      dueDate: loan.dueDate,
      note: loan.note,
      status,
      chargesKobo: chargesKobo.toString(),
      totalToRepayKobo: totalToRepayKobo.toString(),
      repaidKobo: repaidKobo.toString(),
      outstandingKobo: outstandingKobo.toString(),
    },
    ledgerEntries: ledgerEntries.map((entry) => ({
      id: entry.id,
      type: entry.type,
      amountKobo: entry.amountKobo.toString(),
      loanRepaymentId: entry.loanRepaymentId,
      reversesEntryId: entry.reversesEntryId,
      occurredAt: entry.occurredAt.toISOString(),
      isReversal: entry.reversesEntryId !== null,
      reversed: reversedChargeIds.has(entry.id),
      note: entry.note,
    })),
    charges: ledgerEntries
      .filter((entry) => entry.type === "CHARGE")
      .map((entry) => ({
        id: entry.id,
        amountKobo: entry.amountKobo.toString(),
        note: entry.note,
        occurredAt: entry.occurredAt.toISOString(),
        reversed: reversedChargeIds.has(entry.id),
      })),
    repayments: repayments.map((repayment) => ({
      id: repayment.id,
      amountKobo: repayment.amountKobo.toString(),
      interestPortionKobo: repayment.interestPortionKobo.toString(),
      paidAt: repayment.paidAt.toISOString(),
      note: repayment.note,
      accountId: accountEntryByRepayment.get(repayment.id)?.accountId ?? null,
      accountName: accountEntryByRepayment.get(repayment.id)?.account.name ?? null,
      reversed: reversedRepaymentIds.has(repayment.id),
    })),
  };
}
