import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import { getLagosBusinessDate } from "@fabtyna/shared";
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
import type {
  ListCustomersQuery,
  ListSuppliersQuery,
  StatementQuery,
} from "./parties.schemas.js";

export async function listCustomers(prisma: PrismaClient, query: ListCustomersQuery) {
  const conditions: Prisma.Sql[] = [];
  conditions.push(query.active ? Prisma.sql`c."deletedAt" IS NULL` : Prisma.sql`c."deletedAt" IS NOT NULL`);
  if (query.type !== undefined) conditions.push(Prisma.sql`c.type = ${query.type}::"CustomerType"`);
  if (query.q !== undefined) {
    const pattern = likePattern(query.q);
    conditions.push(Prisma.sql`(c.name ILIKE ${pattern} ESCAPE '\\' OR c.phone ILIKE ${pattern} ESCAPE '\\')`);
  }
  if (query.withBalance !== undefined) {
    conditions.push(query.withBalance
      ? Prisma.sql`COALESCE(b.balance, 0) > 0`
      : Prisma.sql`COALESCE(b.balance, 0) <= 0`);
  }
  if (query.cursor !== undefined) {
    const cursor = decodeCursor(query.cursor);
    conditions.push(Prisma.sql`(c.name > ${cursor.at} OR (c.name = ${cursor.at} AND c.id > ${cursor.id}))`);
  }
  const where = Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;
  const rows = await prisma.$queryRaw<Array<{
    id: string; name: string; type: string; phone: string | null; email: string | null;
    creditLimitKobo: string; active: boolean; balanceKobo: string;
  }>>`
    WITH balances AS (
      SELECT "customerId", SUM("amountKobo") AS balance
        FROM customer_ledger_entries GROUP BY "customerId"
    )
    SELECT c.id, c.name, c.type::text AS type, c.phone, c.email,
           c."creditLimitKobo"::text AS "creditLimitKobo",
           (c."deletedAt" IS NULL) AS active,
           COALESCE(b.balance, 0)::text AS "balanceKobo"
      FROM customers c LEFT JOIN balances b ON b."customerId" = c.id
      ${where}
     ORDER BY c.name, c.id
     LIMIT ${query.limit + 1}`;
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page,
    nextCursor: rows.length > query.limit && last ? encodeCursor({ at: last.name, id: last.id }) : null,
  };
}

export async function listSuppliers(prisma: PrismaClient, query: ListSuppliersQuery) {
  const conditions: Prisma.Sql[] = [];
  conditions.push(query.active ? Prisma.sql`s."deletedAt" IS NULL` : Prisma.sql`s."deletedAt" IS NOT NULL`);
  if (query.q !== undefined) {
    const pattern = likePattern(query.q);
    conditions.push(Prisma.sql`(s.name ILIKE ${pattern} ESCAPE '\\' OR s.phone ILIKE ${pattern} ESCAPE '\\')`);
  }
  if (query.withBalance !== undefined) {
    conditions.push(query.withBalance
      ? Prisma.sql`COALESCE(b.balance, 0) > 0`
      : Prisma.sql`COALESCE(b.balance, 0) <= 0`);
  }
  if (query.cursor !== undefined) {
    const cursor = decodeCursor(query.cursor);
    conditions.push(Prisma.sql`(s.name > ${cursor.at} OR (s.name = ${cursor.at} AND s.id > ${cursor.id}))`);
  }
  const where = Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;
  const rows = await prisma.$queryRaw<Array<{
    id: string; name: string; phone: string | null; email: string | null; active: boolean; balanceKobo: string;
  }>>`
    WITH balances AS (
      SELECT "supplierId", SUM("amountKobo") AS balance
        FROM supplier_ledger_entries GROUP BY "supplierId"
    )
    SELECT s.id, s.name, s.phone, s.email, (s."deletedAt" IS NULL) AS active,
           COALESCE(b.balance, 0)::text AS "balanceKobo"
      FROM suppliers s LEFT JOIN balances b ON b."supplierId" = s.id
      ${where}
     ORDER BY s.name, s.id
     LIMIT ${query.limit + 1}`;
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page,
    nextCursor: rows.length > query.limit && last ? encodeCursor({ at: last.name, id: last.id }) : null,
  };
}

function partyBalance(balance: bigint): string {
  return balance.toString();
}

async function customerBalance(prisma: PrismaClient, id: string): Promise<bigint> {
  const row = await prisma.$queryRaw<Array<{ balance: string }>>`
    SELECT COALESCE(SUM("amountKobo"), 0)::text AS balance
      FROM customer_ledger_entries WHERE "customerId" = ${id}`;
  return BigInt(row[0]?.balance ?? "0");
}

async function supplierBalance(prisma: PrismaClient, id: string): Promise<bigint> {
  const row = await prisma.$queryRaw<Array<{ balance: string }>>`
    SELECT COALESCE(SUM("amountKobo"), 0)::text AS balance
      FROM supplier_ledger_entries WHERE "supplierId" = ${id}`;
  return BigInt(row[0]?.balance ?? "0");
}

export async function getCustomerProfile(prisma: PrismaClient, id: string, now: Date) {
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (customer === null) throw new AppError(404, "NOT_FOUND", "Customer not found.", { id });
  const balance = await customerBalance(prisma, id);
  const today = getLagosBusinessDate(now);
  const [unpaidSales, recentSales] = await Promise.all([
    prisma.$queryRaw<Array<{
      id: string; reference: string | null; soldAt: Date; totalKobo: string; paidKobo: string;
      balanceDueKobo: string; daysOutstanding: number; linesSummary: unknown;
    }>>`
      SELECT s.id, s.reference, s."soldAt",
             s."totalKobo"::text AS "totalKobo", s."paidKobo"::text AS "paidKobo",
             (s."totalKobo" - s."paidKobo")::text AS "balanceDueKobo",
             GREATEST(${today}::date - (s."soldAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Lagos')::date, 0)::int AS "daysOutstanding",
             COALESCE((
               SELECT jsonb_agg(jsonb_build_object('productName', p.name, 'quantity', sl.quantity::text, 'unit', sl.unit::text)
                                ORDER BY sl.id)
                 FROM sale_lines sl JOIN products p ON p.id = sl."productId"
                WHERE sl."saleId" = s.id
             ), '[]'::jsonb) AS "linesSummary"
        FROM sales s
       WHERE s."customerId" = ${id} AND s.status <> 'VOIDED' AND s."totalKobo" > s."paidKobo"
       ORDER BY s."soldAt" ASC, s.id ASC`,
    prisma.sale.findMany({
      where: { customerId: id },
      orderBy: [{ soldAt: "desc" }, { id: "desc" }],
      take: 10,
      select: { id: true, reference: true, status: true, totalKobo: true, paidKobo: true, soldAt: true },
    }),
  ]);
  return {
    customer: {
      id: customer.id, name: customer.name, type: customer.type, phone: customer.phone, email: customer.email,
      address: customer.address, notes: customer.notes, creditLimitKobo: customer.creditLimitKobo.toString(),
      active: customer.deletedAt === null,
    },
    balanceKobo: partyBalance(balance),
    unpaidSales: unpaidSales.map((sale) => ({ ...sale, soldAt: sale.soldAt.toISOString() })),
    recentSales: recentSales.map((sale) => ({
      ...sale,
      totalKobo: sale.totalKobo.toString(),
      paidKobo: sale.paidKobo.toString(),
      soldAt: sale.soldAt.toISOString(),
    })),
  };
}

export async function getSupplierProfile(prisma: PrismaClient, id: string, now: Date) {
  const supplier = await prisma.supplier.findUnique({ where: { id } });
  if (supplier === null) throw new AppError(404, "NOT_FOUND", "Supplier not found.", { id });
  const balance = await supplierBalance(prisma, id);
  const today = getLagosBusinessDate(now);
  const [unpaidPurchases, recentPurchases] = await Promise.all([
    prisma.$queryRaw<Array<{
      id: string; reference: string | null; purchasedAt: Date; totalKobo: string; paidKobo: string;
      balanceDueKobo: string; dueDate: string | null; overdue: boolean; daysOverdue: number;
    }>>`
      SELECT p.id, p.reference, p."purchasedAt",
             p."totalKobo"::text AS "totalKobo", p."paidKobo"::text AS "paidKobo",
             (p."totalKobo" - p."paidKobo")::text AS "balanceDueKobo", p."dueDate",
             (p."dueDate" < ${today}) AS overdue,
             GREATEST(${today}::date - p."dueDate"::date, 0)::int AS "daysOverdue"
        FROM purchases p
       WHERE p."supplierId" = ${id} AND p.status <> 'VOIDED' AND p."totalKobo" > p."paidKobo"
       ORDER BY p."purchasedAt" ASC, p.id ASC`,
    prisma.purchase.findMany({
      where: { supplierId: id },
      orderBy: [{ purchasedAt: "desc" }, { id: "desc" }],
      take: 10,
      select: { id: true, reference: true, status: true, totalKobo: true, paidKobo: true, purchasedAt: true },
    }),
  ]);
  return {
    supplier: {
      id: supplier.id, name: supplier.name, phone: supplier.phone, email: supplier.email, address: supplier.address,
      notes: supplier.notes, active: supplier.deletedAt === null,
    },
    balanceKobo: partyBalance(balance),
    unpaidPurchases: unpaidPurchases.map((purchase) => ({ ...purchase, purchasedAt: purchase.purchasedAt.toISOString() })),
    recentPurchases: recentPurchases.map((purchase) => ({
      ...purchase,
      totalKobo: purchase.totalKobo.toString(),
      paidKobo: purchase.paidKobo.toString(),
      purchasedAt: purchase.purchasedAt.toISOString(),
    })),
  };
}

async function statement(
  prisma: PrismaClient,
  input: StatementQuery,
  now: Date,
  maxDays: number,
  entity: { id: string; name: string },
  table: "customer_ledger_entries" | "supplier_ledger_entries",
  fk: "customerId" | "supplierId",
) {
  const range = resolveListDateRange(input, now, maxDays, {
    defaultToToday: true,
    suppressDefault: false,
  });
  const from = range.from!;
  const to = range.to!;
  const startAt = utcTimestamp(lagosDayStartIso(from));
  const endAt = utcTimestamp(lagosDayStartIso(addOneDay(to)));
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;
  const cursorCondition = cursor
    ? Prisma.sql`WHERE (r."occurredAt" > ${utcTimestamp(cursor.at)} OR (r."occurredAt" = ${utcTimestamp(cursor.at)} AND r.id > ${cursor.id}))`
    : Prisma.empty;
  const sourceDescription = table === "customer_ledger_entries"
    ? Prisma.sql`CASE
        WHEN le."saleId" IS NOT NULL THEN COALESCE(s.reference, 'Sale ' || le."saleId")
        ELSE COALESCE(le.note, replace(le.type::text, '_', ' '))
      END`
    : Prisma.sql`CASE
        WHEN le."purchaseId" IS NOT NULL THEN COALESCE(p.reference, 'Purchase ' || le."purchaseId")
        ELSE COALESCE(le.note, replace(le.type::text, '_', ' '))
      END`;
  const sourceJoins = table === "customer_ledger_entries"
    ? Prisma.sql`LEFT JOIN sales s ON s.id = le."saleId"`
    : Prisma.sql`LEFT JOIN purchases p ON p.id = le."purchaseId"`;
  const rows = await prisma.$queryRaw<Array<{
    id: string | null; type: string | null; amountKobo: string | null; occurredAt: Date | null; note: string | null;
    reversesEntryId: string | null; reversedByEntryId: string | null; sourceDescription: string | null;
    runningBalanceKobo: string | null; openingBalanceKobo: string; closingBalanceKobo: string;
  }>>`
    WITH opening AS (
      SELECT COALESCE(SUM("amountKobo"), 0)::text AS balance FROM ${Prisma.raw(table)}
       WHERE ${Prisma.raw(`"${fk}"`)} = ${entity.id} AND "occurredAt" < ${startAt}
    ),
    ranged AS (
      SELECT le.id, le.type::text AS type, le."amountKobo"::text AS "amountKobo",
             le."occurredAt", le.note, le."reversesEntryId", reversal.id AS "reversedByEntryId",
             ${sourceDescription} AS "sourceDescription",
             SUM(le."amountKobo") OVER (ORDER BY le."occurredAt", le.id)::text AS "rangeRunning"
        FROM ${Prisma.raw(table)} le
        LEFT JOIN ${Prisma.raw(table)} reversal ON reversal."reversesEntryId" = le.id
        ${sourceJoins}
       WHERE le.${Prisma.raw(`"${fk}"`)} = ${entity.id}
         AND le."occurredAt" >= ${startAt} AND le."occurredAt" < ${endAt}
    ),
    totals AS (
      SELECT opening.balance AS opening,
             (opening.balance::bigint + COALESCE((SELECT SUM("amountKobo"::bigint) FROM ranged), 0))::text AS closing
        FROM opening
    ),
    page AS (
      SELECT r.* FROM ranged r ${cursorCondition}
       ORDER BY r."occurredAt", r.id LIMIT ${input.limit + 1}
    )
    SELECT page.id, page.type, page."amountKobo", page."occurredAt", page.note, page."reversesEntryId",
           page."reversedByEntryId", page."sourceDescription",
           (totals.opening::bigint + page."rangeRunning"::bigint)::text AS "runningBalanceKobo",
           totals.opening AS "openingBalanceKobo", totals.closing AS "closingBalanceKobo"
      FROM totals LEFT JOIN page ON TRUE ORDER BY page."occurredAt" NULLS FIRST, page.id NULLS FIRST`;
  const entries = rows.filter((row) => row.id !== null).slice(0, input.limit);
  const first = rows[0];
  const last = entries.at(-1);
  const nextCursor = rows.filter((row) => row.id !== null).length > input.limit && last?.occurredAt
    ? encodeCursor({ at: last.occurredAt.toISOString(), id: last.id! })
    : null;
  return {
    party: entity,
    from,
    to,
    openingBalanceKobo: first?.openingBalanceKobo ?? "0",
    closingBalanceKobo: first?.closingBalanceKobo ?? first?.openingBalanceKobo ?? "0",
    entries: entries.map((entry) => ({
      id: entry.id,
      type: entry.type,
      amountKobo: entry.amountKobo,
      occurredAt: entry.occurredAt?.toISOString() ?? null,
      note: entry.note,
      sourceDescription: entry.sourceDescription,
      isReversal: entry.reversesEntryId !== null,
      reversesEntryId: entry.reversesEntryId,
      reversedByEntryId: entry.reversedByEntryId,
      runningBalanceKobo: entry.runningBalanceKobo,
    })),
    nextCursor,
  };
}

export async function getCustomerStatement(prisma: PrismaClient, id: string, query: StatementQuery, now: Date, maxDays: number) {
  const customer = await prisma.customer.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!customer) throw new AppError(404, "NOT_FOUND", "Customer not found.", { id });
  return statement(prisma, query, now, maxDays, customer, "customer_ledger_entries", "customerId");
}

export async function getSupplierStatement(prisma: PrismaClient, id: string, query: StatementQuery, now: Date, maxDays: number) {
  const supplier = await prisma.supplier.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!supplier) throw new AppError(404, "NOT_FOUND", "Supplier not found.", { id });
  return statement(prisma, query, now, maxDays, supplier, "supplier_ledger_entries", "supplierId");
}

export async function listDebtors(
  prisma: PrismaClient,
  query: { q?: string; minBalanceKobo?: string; limit: number; cursor?: string },
  now: Date,
) {
  const today = getLagosBusinessDate(now);
  const conditions: Prisma.Sql[] = [];
  if (query.q) {
    const pattern = likePattern(query.q);
    conditions.push(Prisma.sql`(eligible.name ILIKE ${pattern} ESCAPE '\\' OR eligible.phone ILIKE ${pattern} ESCAPE '\\')`);
  }
  if (query.minBalanceKobo) conditions.push(Prisma.sql`eligible.balance >= ${BigInt(query.minBalanceKobo)}`);
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (cursor) {
    conditions.push(Prisma.sql`(eligible.balance < ${BigInt(cursor.at)} OR (eligible.balance = ${BigInt(cursor.at)} AND eligible.id > ${cursor.id}))`);
  }
  const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<{
    id: string; name: string; phone: string | null; type: string; balanceKobo: string; grandTotalKobo: string;
    oldestUnpaidDate: Date | null; sales: unknown;
  }>>`
    WITH balances AS (
      SELECT "customerId", SUM("amountKobo") AS balance FROM customer_ledger_entries GROUP BY "customerId"
    ),
    unpaid AS (
      SELECT s."customerId", s.id, s.reference, s."soldAt", s."totalKobo", s."paidKobo",
             (s."totalKobo" - s."paidKobo") AS due,
             COALESCE((
               SELECT jsonb_agg(jsonb_build_object('productName', p.name, 'quantity', sl.quantity::text, 'unit', sl.unit::text) ORDER BY sl.id)
                 FROM sale_lines sl JOIN products p ON p.id = sl."productId" WHERE sl."saleId" = s.id
             ), '[]'::jsonb) AS lines
        FROM sales s
       WHERE s.status <> 'VOIDED' AND s."totalKobo" > s."paidKobo" AND s."customerId" IS NOT NULL
    ),
    eligible AS (
      SELECT c.id, c.name, c.phone, c.type::text AS type, b.balance,
             MIN(u."soldAt") AS oldest,
             jsonb_agg(jsonb_build_object(
               'id', u.id, 'reference', u.reference, 'soldAt', u."soldAt",
               'totalKobo', u."totalKobo"::text, 'paidKobo', u."paidKobo"::text,
               'balanceDueKobo', u.due::text, 'lines', u.lines,
               'daysOutstanding', GREATEST(${today}::date - (u."soldAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Lagos')::date, 0)
             ) ORDER BY u."soldAt", u.id) AS sales
        FROM customers c JOIN balances b ON b."customerId" = c.id
        JOIN unpaid u ON u."customerId" = c.id
       WHERE b.balance > 0
       GROUP BY c.id, c.name, c.phone, c.type, b.balance
    )
    SELECT eligible.id, eligible.name, eligible.phone, eligible.type, eligible.balance::text AS "balanceKobo",
           eligible.oldest AS "oldestUnpaidDate", eligible.sales,
           (SELECT COALESCE(SUM(balance), 0)::text FROM eligible) AS "grandTotalKobo"
      FROM eligible
      ${where}
     ORDER BY eligible.balance DESC, eligible.id ASC
     LIMIT ${query.limit + 1}`;
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(({ grandTotalKobo: _grand, ...row }) => ({ ...row, oldestUnpaidDate: row.oldestUnpaidDate?.toISOString() ?? null })),
    grandTotalKobo: rows[0]?.grandTotalKobo ?? "0",
    nextCursor: rows.length > query.limit && last ? encodeCursor({ at: last.balanceKobo, id: last.id }) : null,
  };
}

export async function listPayables(prisma: PrismaClient, query: { q?: string; overdueOnly?: boolean; limit: number; cursor?: string }, now: Date) {
  const today = getLagosBusinessDate(now);
  const conditions: Prisma.Sql[] = [];
  if (query.q) {
    const pattern = likePattern(query.q);
    conditions.push(Prisma.sql`(eligible.name ILIKE ${pattern} ESCAPE '\\' OR eligible.phone ILIKE ${pattern} ESCAPE '\\')`);
  }
  if (query.overdueOnly) conditions.push(Prisma.sql`eligible.has_overdue`);
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (cursor) conditions.push(Prisma.sql`(eligible.balance < ${BigInt(cursor.at)} OR (eligible.balance = ${BigInt(cursor.at)} AND eligible.id > ${cursor.id}))`);
  const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<{
    id: string; name: string; phone: string | null; balanceKobo: string; purchases: unknown;
    grandTotalKobo: string; overdueTotalKobo: string;
  }>>`
    WITH balances AS (
      SELECT "supplierId", SUM("amountKobo") AS balance FROM supplier_ledger_entries GROUP BY "supplierId"
    ),
    unpaid AS (
      SELECT p.* FROM purchases p
       WHERE p.status <> 'VOIDED' AND p."totalKobo" > p."paidKobo" AND p."supplierId" IS NOT NULL
    ),
    eligible AS (
      SELECT s.id, s.name, s.phone, b.balance,
             jsonb_agg(jsonb_build_object(
               'id', p.id, 'reference', p.reference, 'purchasedAt', p."purchasedAt",
               'totalKobo', p."totalKobo"::text, 'paidKobo', p."paidKobo"::text,
               'balanceDueKobo', (p."totalKobo" - p."paidKobo")::text,
               'dueDate', p."dueDate", 'overdue', COALESCE(p."dueDate" < ${today}, false),
               'daysOverdue', CASE WHEN p."dueDate" < ${today} THEN ${today}::date - p."dueDate"::date ELSE 0 END
             ) ORDER BY p."purchasedAt", p.id) AS purchases,
             SUM(CASE WHEN p."dueDate" < ${today}
                      THEN p."totalKobo" - p."paidKobo" ELSE 0 END) AS overdue_balance,
             BOOL_OR(p."dueDate" < ${today}) AS has_overdue
        FROM suppliers s JOIN balances b ON b."supplierId" = s.id
        JOIN unpaid p ON p."supplierId" = s.id
       GROUP BY s.id, s.name, s.phone, b.balance
    )
    SELECT eligible.id, eligible.name, eligible.phone, eligible.balance::text AS "balanceKobo",
           eligible.purchases,
           (SELECT COALESCE(SUM(balance), 0)::text FROM eligible) AS "grandTotalKobo",
           (SELECT COALESCE(SUM(overdue_balance), 0)::text FROM eligible) AS "overdueTotalKobo"
      FROM eligible
      ${where}
     ORDER BY eligible.balance DESC, eligible.id ASC
     LIMIT ${query.limit + 1}`;
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(({ grandTotalKobo: _grand, overdueTotalKobo: _overdue, ...row }) => row),
    grandTotalKobo: rows[0]?.grandTotalKobo ?? "0",
    overdueTotalKobo: rows[0]?.overdueTotalKobo ?? "0",
    nextCursor: rows.length > query.limit && last ? encodeCursor({ at: last.balanceKobo, id: last.id }) : null,
  };
}
