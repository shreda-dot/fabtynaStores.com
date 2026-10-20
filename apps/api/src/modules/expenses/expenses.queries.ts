import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import { splitExpenseByChannel } from "@fabtyna/shared";
import {
  addOneDay,
  decodeCursor,
  encodeCursor,
  lagosDayStartIso,
  likePattern,
  resolveListDateRange,
  utcTimestamp,
} from "../../lib/list-helpers.js";
import type { ExpenseSummaryQuery, ListExpensesQuery } from "./expenses.schemas.js";

interface ExpenseRow {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryCode: string | null;
  accountId: string;
  accountName: string;
  channel: "RETAIL" | "WHOLESALE" | "BOTH";
  description: string;
  amountKobo: string;
  expenseDate: Date;
  voidedAt: Date | null;
  voidReason: string | null;
}

export interface ExpenseListPage {
  items: Array<Omit<ExpenseRow, "expenseDate" | "voidedAt" | "amountKobo" | "categoryCode"> & {
    expenseDate: string;
    amountKobo: string;
    voided: boolean;
    voidedAt: string | null;
  }>;
  nextCursor: string | null;
  from: string | null;
  to: string | null;
}

function dateConditions(from?: string, to?: string): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [];
  if (from !== undefined) {
    conditions.push(Prisma.sql`e."expenseDate" >= ${utcTimestamp(lagosDayStartIso(from))}`);
  }
  if (to !== undefined) {
    conditions.push(Prisma.sql`e."expenseDate" < ${utcTimestamp(lagosDayStartIso(addOneDay(to)))}`);
  }
  return conditions;
}

function expenseBaseQuery(where: Prisma.Sql) {
  return Prisma.sql`
    SELECT e.id, e."categoryId", ec.name AS "categoryName", ec.code AS "categoryCode",
           ale."accountId", a.name AS "accountName", e.channel::text AS channel,
           e.description, e."amountKobo"::text AS "amountKobo", e."expenseDate",
           e."voidedAt", e."voidReason"
      FROM expenses e
      JOIN expense_categories ec ON ec.id = e."categoryId"
      JOIN account_ledger_entries ale
        ON ale."expenseId" = e.id AND ale."reversesEntryId" IS NULL
      JOIN accounts a ON a.id = ale."accountId"
      ${where}`;
}

export async function listExpenses(
  prisma: PrismaClient,
  query: ListExpensesQuery,
  now: Date,
  maxDateRangeDays: number,
): Promise<ExpenseListPage> {
  const range = resolveListDateRange(query, now, maxDateRangeDays, {
    defaultToToday: true,
    suppressDefault: false,
  });
  const conditions = dateConditions(range.from, range.to);
  if (!query.includeVoided) conditions.push(Prisma.sql`e."voidedAt" IS NULL`);
  if (query.categoryId !== undefined) {
    conditions.push(Prisma.sql`e."categoryId" = ANY(${query.categoryId}::text[])`);
  }
  if (query.channel !== undefined) conditions.push(Prisma.sql`e.channel = ${query.channel}::"SaleChannel"`);
  if (query.accountId !== undefined) conditions.push(Prisma.sql`ale."accountId" = ${query.accountId}`);
  if (query.q !== undefined) {
    conditions.push(Prisma.sql`e.description ILIKE ${likePattern(query.q)} ESCAPE '\\'`);
  }
  if (query.cursor !== undefined) {
    const cursor = decodeCursor(query.cursor);
    conditions.push(
      Prisma.sql`(e."expenseDate" < ${utcTimestamp(cursor.at)}
        OR (e."expenseDate" = ${utcTimestamp(cursor.at)} AND e.id < ${cursor.id}))`,
    );
  }
  const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
  const rows = await prisma.$queryRaw<ExpenseRow[]>`
    ${expenseBaseQuery(where)}
    ORDER BY e."expenseDate" DESC, e.id DESC
    LIMIT ${query.limit + 1}`;
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      id: row.id,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      accountId: row.accountId,
      accountName: row.accountName,
      channel: row.channel,
      description: row.description,
      amountKobo: row.amountKobo,
      expenseDate: row.expenseDate.toISOString(),
      voided: row.voidedAt !== null,
      voidedAt: row.voidedAt?.toISOString() ?? null,
      voidReason: row.voidReason,
    })),
    nextCursor:
      rows.length > query.limit && last !== undefined
        ? encodeCursor({ at: last.expenseDate.toISOString(), id: last.id })
        : null,
    from: range.from ?? null,
    to: range.to ?? null,
  };
}

export async function summarizeExpenses(
  prisma: PrismaClient,
  query: ExpenseSummaryQuery,
  now: Date,
  maxDateRangeDays: number,
) {
  const range = resolveListDateRange(query, now, maxDateRangeDays, {
    defaultToToday: true,
    suppressDefault: false,
  });
  const conditions = [...dateConditions(range.from, range.to), Prisma.sql`e."voidedAt" IS NULL`];
  if (query.categoryId !== undefined) conditions.push(Prisma.sql`e."categoryId" = ${query.categoryId}`);
  if (query.accountId !== undefined) conditions.push(Prisma.sql`ale."accountId" = ${query.accountId}`);
  if (query.channel !== undefined) {
    conditions.push(Prisma.sql`(e.channel = ${query.channel}::"SaleChannel" OR e.channel = 'BOTH')`);
  }
  const where = Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;
  const rows = await prisma.$queryRaw<ExpenseRow[]>`${expenseBaseQuery(where)}`;

  const categories = new Map<string, { id: string; name: string; total: bigint; count: number }>();
  let total = 0n;
  for (const row of rows) {
    const amount = BigInt(row.amountKobo);
    let allocated = amount;
    if (query.channel !== undefined && row.channel === "BOTH") {
      const split = splitExpenseByChannel(amount, row.channel);
      allocated = query.channel === "RETAIL" ? split.retailKobo : split.wholesaleKobo;
    }
    total += allocated;
    const current = categories.get(row.categoryId) ?? {
      id: row.categoryId,
      name: row.categoryName,
      total: 0n,
      count: 0,
    };
    current.total += allocated;
    current.count += 1;
    categories.set(row.categoryId, current);
  }

  return {
    from: range.from ?? null,
    to: range.to ?? null,
    totalKobo: total.toString(),
    count: rows.length,
    byCategory: [...categories.values()]
      .sort((a, b) => (a.total === b.total ? a.name.localeCompare(b.name) : a.total > b.total ? -1 : 1))
      .map((category) => ({
        id: category.id,
        name: category.name,
        totalKobo: category.total.toString(),
        count: category.count,
      })),
  };
}
