import {
  accountMoneyFlowReport,
  computeFinancialPosition,
  getLagosBusinessDate,
  getLagosBusinessDayRange,
  salesSummary,
  stockWorthAtCost,
  stockWorthAtRetail,
  stockWorthAtWholesale,
  type Account,
  type AccountLedgerEntry,
  type Expense,
  type FinancialPositionProductInput,
  type Product,
  type Sale,
  type SaleLine,
  type SalePayment,
  type StockMovement,
} from "@fabtyna/shared";
import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import {
  addOneDay,
  lagosDayStartIso,
  resolveListDateRange,
} from "../../lib/list-helpers.js";
import type {
  FinancialPositionQuery,
  MoneyFlowQuery,
  ProductSalesQuery,
  SalesSummaryQuery,
} from "./reports.schemas.js";

function summaryDateRange(
  query: { from?: string; to?: string },
  now: Date,
  maxDays: number,
) {
  const range = resolveListDateRange(query, now, maxDays, {
    defaultToToday: true,
    suppressDefault: false,
  });
  return {
    from: range.from!,
    to: range.to!,
    start: new Date(lagosDayStartIso(range.from!)),
    end: new Date(lagosDayStartIso(addOneDay(range.to!))),
  };
}

async function loadSalesSummaryData(
  prisma: PrismaClient,
  from: Date,
  to: Date,
) {
  const sales = await prisma.sale.findMany({
    where: {
      OR: [
        { soldAt: { gte: from, lt: to } },
        { payments: { some: { paidAt: { gte: from, lt: to } } } },
      ],
    },
  });
  const salesInRange = sales.filter((sale) => sale.soldAt >= from && sale.soldAt < to);
  const saleIds = salesInRange.map((sale) => sale.id);
  const payments = await prisma.salePayment.findMany({
    where: { paidAt: { gte: from, lt: to } },
  });
  const paymentIds = payments.map((payment) => payment.id);
  const [lines, expenses, reversalRows] = await Promise.all([
    saleIds.length === 0
      ? Promise.resolve([])
      : prisma.saleLine.findMany({ where: { saleId: { in: saleIds } } }),
    prisma.expense.findMany({
      where: { expenseDate: { gte: from, lt: to }, voidedAt: null },
    }),
    paymentIds.length === 0
      ? Promise.resolve([])
      : prisma.accountLedgerEntry.findMany({
          where: {
            salePaymentId: { in: paymentIds },
            reversesEntryId: { not: null },
          },
          select: { salePaymentId: true },
        }),
  ]);
  const productIds = [...new Set(lines.map((line) => line.productId))];
  const products = productIds.length === 0
    ? []
    : await prisma.product.findMany({ where: { id: { in: productIds } } });

  const reversedPaymentIds = new Set(
    reversalRows.flatMap((entry) => entry.salePaymentId === null ? [] : [entry.salePaymentId]),
  );
  const domainExpenses: Expense[] = expenses.map((expense) => ({
    id: expense.id,
    channel: expense.channel,
    category: "OTHER",
    description: expense.description,
    amountKobo: expense.amountKobo,
    expenseDate: expense.expenseDate,
    loanRepaymentId: expense.loanRepaymentId,
    voidedAt: expense.voidedAt,
    voidReason: expense.voidReason,
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
  }));

  return {
    sales: sales as Sale[],
    lines: lines as SaleLine[],
    products: products as Product[],
    expenses: domainExpenses,
    payments: payments as SalePayment[],
    reversedPaymentIds,
    salesInRange,
  };
}

function stringifyDay(day: ReturnType<typeof salesSummary>["days"][number]) {
  return Object.fromEntries(
    Object.entries(day).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value]),
  ) as Record<string, string | number>;
}

function stringifyTotals(totals: ReturnType<typeof salesSummary>["totals"]) {
  return Object.fromEntries(
    Object.entries(totals).map(([key, value]) => [key, value.toString()]),
  ) as Record<string, string>;
}

function filterSummaryChannel(
  days: ReturnType<typeof salesSummary>["days"],
  totals: ReturnType<typeof salesSummary>["totals"],
  channel: "RETAIL" | "WHOLESALE" | undefined,
) {
  if (channel === undefined) return { days, totals };
  const selected = channel === "RETAIL" ? "retail" : "wholesale";
  const excluded = channel === "RETAIL" ? "wholesale" : "retail";
  const select = <T extends object>(values: T): T => {
    const entries = Object.entries(values);
    return Object.fromEntries(entries.map(([key, value]) => {
      if (typeof value !== "bigint") return [key, value];
      if (key.startsWith(excluded)) return [key, 0n];
      if (key.startsWith("total")) {
        const selectedKey = `${selected}${key.slice("total".length)}`;
        return [key, entries.find(([candidate]) => candidate === selectedKey)?.[1] ?? 0n];
      }
      return [key, value];
    })) as T;
  };
  return {
    days: days.map((day) => select(day)),
    totals: select(totals),
  };
}

export async function getSalesSummary(
  prisma: PrismaClient,
  query: SalesSummaryQuery,
  now: Date,
  maxDays: number,
) {
  const range = summaryDateRange(query, now, maxDays);
  const data = await loadSalesSummaryData(prisma, range.start, range.end);
  const sales = query.channel
    ? data.sales.filter((sale) => sale.channel === query.channel)
    : data.sales;
  const result = salesSummary(
    range.start,
    range.end,
    sales,
    data.lines,
    data.products,
    data.expenses,
    data.payments,
    data.reversedPaymentIds,
  );
  const filtered = filterSummaryChannel(result.days, result.totals, query.channel);
  return {
    days: filtered.days.map(stringifyDay),
    totals: stringifyTotals(filtered.totals),
    from: range.from,
    to: range.to,
    channel: query.channel ?? null,
  };
}

export async function getDashboard(
  prisma: PrismaClient,
  date: string,
) {
  const { start, end } = getLagosBusinessDayRange(date);
  const yesterday = getLagosBusinessDate(new Date(start.getTime() - 24 * 60 * 60 * 1000));
  const yesterdayRange = getLagosBusinessDayRange(yesterday);
  const data = await loadSalesSummaryData(prisma, yesterdayRange.start, end);
  const summary = salesSummary(
    yesterdayRange.start,
    end,
    data.sales,
    data.lines,
    data.products,
    data.expenses,
    data.payments,
    data.reversedPaymentIds,
  );
  const todayDay = summary.days.find((day) => day.date === date);
  const yesterdayDay = summary.days.find((day) => day.date === yesterday);
  const debtByDate = (targetDate: string) => data.salesInRange
    .filter((sale) => sale.status !== "VOIDED" && getLagosBusinessDate(sale.soldAt) === targetDate)
    .reduce((sum, sale) => sum + (sale.totalKobo > sale.paidKobo ? sale.totalKobo - sale.paidKobo : 0n), 0n);

  const stock = await currentStockWorth(prisma);
  const value = (day: typeof todayDay, key: keyof NonNullable<typeof todayDay>) =>
    (day?.[key] as bigint | undefined ?? 0n).toString();
  const metrics = {
    netProfitKobo: { value: value(todayDay, "totalNetProfitKobo"), yesterday: value(yesterdayDay, "totalNetProfitKobo") },
    revenueGottenKobo: { value: value(todayDay, "totalRevenueGottenKobo"), yesterday: value(yesterdayDay, "totalRevenueGottenKobo") },
    expensesKobo: { value: value(todayDay, "totalExpensesKobo"), yesterday: value(yesterdayDay, "totalExpensesKobo") },
    debtKobo: { value: debtByDate(date).toString(), yesterday: debtByDate(yesterday).toString() },
  };

  return {
    date,
    metrics,
    channels: {
      RETAIL: {
        supposedKobo: value(todayDay, "retailSupposedRevenueKobo"),
        gottenKobo: value(todayDay, "retailRevenueGottenKobo"),
        debtKobo: data.salesInRange
          .filter((sale) => sale.channel === "RETAIL" && sale.status !== "VOIDED" && getLagosBusinessDate(sale.soldAt) === date)
          .reduce((sum, sale) => sum + (sale.totalKobo > sale.paidKobo ? sale.totalKobo - sale.paidKobo : 0n), 0n)
          .toString(),
      },
      WHOLESALE: {
        supposedKobo: value(todayDay, "wholesaleSupposedRevenueKobo"),
        gottenKobo: value(todayDay, "wholesaleRevenueGottenKobo"),
        debtKobo: data.salesInRange
          .filter((sale) => sale.channel === "WHOLESALE" && sale.status !== "VOIDED" && getLagosBusinessDate(sale.soldAt) === date)
          .reduce((sum, sale) => sum + (sale.totalKobo > sale.paidKobo ? sale.totalKobo - sale.paidKobo : 0n), 0n)
          .toString(),
      },
    },
    stock: {
      asOf: "now",
      worthAtCostKobo: stock.cost.toString(),
      worthAtRetailKobo: stock.retail.toString(),
      worthAtWholesaleKobo: stock.wholesale.toString(),
    },
  };
}

async function currentStockWorth(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<Array<{
    id: string;
    unitsPerPack: number;
    retailPriceKobo: bigint;
    wholesalePriceKobo: bigint;
    averageCostKobo: bigint;
    locations: Record<string, number> | null;
  }>>`
    SELECT p.id, p."unitsPerPack", p."retailPriceKobo", p."wholesalePriceKobo", p."averageCostKobo",
           COALESCE(jsonb_object_agg(sb.location::text, sb."quantityUnits")
             FILTER (WHERE sb.location IS NOT NULL), '{}'::jsonb) AS locations
      FROM products p
      LEFT JOIN stock_balances sb ON sb."productId" = p.id
     GROUP BY p.id`;
  let cost = 0n;
  let retail = 0n;
  let wholesale = 0n;
  for (const row of rows) {
    const movements: StockMovement[] = Object.entries(row.locations ?? {}).map(([location, quantityUnits]) => ({
      id: `${row.id}:${location}`,
      productId: row.id,
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
    const product = {
      id: row.id,
      unitsPerPack: row.unitsPerPack,
      averageCostKobo: row.averageCostKobo,
      retailPriceKobo: row.retailPriceKobo,
      wholesalePriceKobo: row.wholesalePriceKobo,
    };
    cost += stockWorthAtCost(movements, product);
    retail += stockWorthAtRetail(movements, product);
    wholesale += stockWorthAtWholesale(movements, product);
  }
  return { cost, retail, wholesale };
}

export async function getProductSales(
  prisma: PrismaClient,
  query: ProductSalesQuery,
  now: Date,
  maxDays: number,
) {
  const range = summaryDateRange(query, now, maxDays);
  const rows = await prisma.$queryRaw<Array<{
    productId: string;
    productName: string;
    unitsSold: string;
    billedRevenueKobo: string;
    cogsKobo: string;
  }>>`
    SELECT p.id AS "productId", p.name AS "productName",
           SUM(sl."quantityUnits")::text AS "unitsSold",
           SUM(sl."lineTotalKobo")::text AS "billedRevenueKobo",
           SUM(sl."costPerUnitKobo" * sl."quantityUnits")::text AS "cogsKobo"
      FROM sales s
      JOIN sale_lines sl ON sl."saleId" = s.id
      JOIN products p ON p.id = sl."productId"
     WHERE s.status <> 'VOIDED'
       AND s."soldAt" >= ${range.start}
       AND s."soldAt" < ${range.end}
       ${query.channel === undefined ? Prisma.empty : Prisma.sql`AND s.channel = ${query.channel}::"SaleChannel"`}
     GROUP BY p.id, p.name
     ORDER BY SUM(sl."lineTotalKobo") DESC, p.name, p.id
     LIMIT ${query.limit}`;
  return {
    items: rows.map((row) => {
      const revenue = BigInt(row.billedRevenueKobo);
      const cogs = BigInt(row.cogsKobo);
      return {
        productId: row.productId,
        productName: row.productName,
        unitsSold: row.unitsSold,
        billedRevenueKobo: revenue.toString(),
        cogsKobo: cogs.toString(),
        grossProfitKobo: (revenue - cogs).toString(),
      };
    }),
    from: range.from,
    to: range.to,
    channel: query.channel ?? null,
    revenueDefinition: "Billed line totals, not cash received.",
  };
}

export async function getMoneyFlow(
  prisma: PrismaClient,
  query: MoneyFlowQuery,
  now: Date,
  maxDays: number,
) {
  const range = summaryDateRange(query, now, maxDays);
  const [accounts, openingRows, entries, sales, customerBalanceRows] = await Promise.all([
    prisma.account.findMany({ where: query.accountId === undefined ? {} : { id: query.accountId } }),
    prisma.$queryRaw<Array<{ accountId: string; amountKobo: bigint }>>`
      SELECT "accountId", COALESCE(SUM("amountKobo"), 0)::bigint AS "amountKobo"
        FROM account_ledger_entries
       WHERE "occurredAt" < ${range.start}
         ${query.accountId === undefined ? Prisma.empty : Prisma.sql`AND "accountId" = ${query.accountId}`}
       GROUP BY "accountId"`,
    prisma.accountLedgerEntry.findMany({
      where: {
        occurredAt: { gte: range.start, lt: range.end },
        ...(query.accountId === undefined ? {} : { accountId: query.accountId }),
      },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    }),
    prisma.sale.findMany({
      where: { soldAt: { gte: range.start, lt: range.end } },
    }),
    prisma.$queryRaw<Array<{ debtsOwedNowKobo: bigint }>>`
      SELECT COALESCE(SUM(balance), 0)::bigint AS "debtsOwedNowKobo"
        FROM (SELECT SUM("amountKobo") AS balance FROM customer_ledger_entries
               GROUP BY "customerId" HAVING SUM("amountKobo") > 0) balances`,
  ]);
  if (query.accountId !== undefined && accounts.length === 0) {
    throw new AppError(404, "NOT_FOUND", "Account not found.", { accountId: query.accountId });
  }
  const expenseIds = [...new Set(entries.flatMap((entry) => entry.expenseId === null ? [] : [entry.expenseId]))];
  const expenseRows = expenseIds.length === 0
    ? []
    : await prisma.expense.findMany({
        where: { id: { in: expenseIds } },
        include: { category: { select: { code: true, name: true } } },
      });
  const expenses = expenseRows.map((expense) => ({
    id: expense.id,
    channel: expense.channel,
    category: (expense.category.code ?? expense.category.name) as Expense["category"],
    description: expense.description,
    amountKobo: expense.amountKobo,
    expenseDate: expense.expenseDate,
    loanRepaymentId: expense.loanRepaymentId,
    voidedAt: expense.voidedAt,
    voidReason: expense.voidReason,
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
  })) as Expense[];
  const openings: AccountLedgerEntry[] = openingRows.map((row) => ({
    id: `opening:${row.accountId}`,
    accountId: row.accountId,
    type: "ADJUSTMENT",
    amountKobo: row.amountKobo,
    salePaymentId: null,
    customerPaymentId: null,
    supplierPaymentId: null,
    purchaseId: null,
    expenseId: null,
    otherIncomeId: null,
    accountTransferId: null,
    customerRefundId: null,
    loanId: null,
    loanRepaymentId: null,
    reversesEntryId: null,
    note: null,
    occurredAt: new Date(range.start.getTime() - 1),
  }));
  const report = accountMoneyFlowReport(
    accounts as Account[],
    [...openings, ...entries] as AccountLedgerEntry[],
    expenses,
    sales as Sale[],
    range.start,
    range.end,
    query.accountId,
  );
  const transferEntries = entries.filter((entry) => entry.type === "TRANSFER_IN" || entry.type === "TRANSFER_OUT");
  const transferIn = transferEntries.reduce((sum, entry) => sum + (entry.amountKobo > 0n ? entry.amountKobo : 0n), 0n);
  const transferOut = transferEntries.reduce((sum, entry) => sum + (entry.amountKobo < 0n ? -entry.amountKobo : 0n), 0n);
  const salesReceived = entries
    .filter((entry) => entry.type === "SALE_PAYMENT" || entry.type === "CUSTOMER_PAYMENT")
    .reduce((sum, entry) => sum + entry.amountKobo, 0n);
  return {
    from: range.from,
    to: range.to,
    rows: report.rows.map((row) => ({
      ...row,
      openingBalanceKobo: row.openingBalanceKobo.toString(),
      moneyInKobo: row.moneyInKobo.toString(),
      moneyOutKobo: row.moneyOutKobo.toString(),
      netKobo: row.netKobo.toString(),
      closingBalanceKobo: row.closingBalanceKobo.toString(),
      categories: row.categories.map((category) => ({
        key: category.key,
        moneyInKobo: category.moneyInKobo.toString(),
        moneyOutKobo: category.moneyOutKobo.toString(),
      })),
    })),
    totals: {
      openingBalanceKobo: report.totalOpeningBalanceKobo.toString(),
      moneyInKobo: (report.totalMoneyInKobo - transferIn).toString(),
      moneyOutKobo: (report.totalMoneyOutKobo - transferOut).toString(),
      netKobo: report.totalNetKobo.toString(),
      closingBalanceKobo: report.totalClosingBalanceKobo.toString(),
    },
    transfers: {
      moneyInKobo: transferIn.toString(),
      moneyOutKobo: transferOut.toString(),
    },
    sales: {
      salesBilledKobo: report.salesBilledKobo.toString(),
      cashReceivedFromSalesKobo: salesReceived.toString(),
      debtsFromRangeSalesKobo: report.salesDebtOutstandingKobo.toString(),
      debtsOwedNowKobo: (customerBalanceRows[0]?.debtsOwedNowKobo ?? 0n).toString(),
    },
  };
}

export async function getFinancialPosition(
  prisma: PrismaClient,
  query: FinancialPositionQuery,
  now: Date,
) {
  const today = getLagosBusinessDate(now);
  const [stockRows, cashRows, receivableRows, payableRows, loanRows, obligationRows] = await Promise.all([
    prisma.$queryRaw<Array<{
      productId: string; productName: string; unitsPerPack: number; warehouseUnits: number;
      fridgeUnits: number; retailPriceKobo: bigint; wholesalePriceKobo: bigint; averageCostKobo: bigint;
    }>>`
      SELECT p.id AS "productId", p.name AS "productName", p."unitsPerPack",
             COALESCE(SUM(sb."quantityUnits") FILTER (WHERE sb.location = 'WAREHOUSE'), 0)::int AS "warehouseUnits",
             COALESCE(SUM(sb."quantityUnits") FILTER (WHERE sb.location IN ('RETAIL_SHELF', 'MARKET')), 0)::int AS "fridgeUnits",
             p."retailPriceKobo", p."wholesalePriceKobo", p."averageCostKobo"
        FROM products p LEFT JOIN stock_balances sb ON sb."productId" = p.id
       GROUP BY p.id`,
    prisma.$queryRaw<Array<{ cashKobo: bigint }>>`
      SELECT COALESCE(SUM("balanceKobo"), 0)::bigint AS "cashKobo" FROM account_balances`,
    prisma.$queryRaw<Array<{ receivablesKobo: bigint }>>`
      SELECT COALESCE(SUM(balance), 0)::bigint AS "receivablesKobo"
        FROM (SELECT SUM("amountKobo") AS balance FROM customer_ledger_entries
               GROUP BY "customerId" HAVING SUM("amountKobo") > 0) balances`,
    prisma.$queryRaw<Array<{ supplierId: string; supplierName: string; amountKobo: bigint }>>`
      SELECT s.id AS "supplierId", s.name AS "supplierName", SUM(le."amountKobo")::bigint AS "amountKobo"
        FROM supplier_ledger_entries le JOIN suppliers s ON s.id = le."supplierId"
       GROUP BY s.id, s.name HAVING SUM(le."amountKobo") > 0`,
    prisma.$queryRaw<Array<{ loanId: string; lenderName: string; dueDate: string | null; amountKobo: bigint }>>`
      SELECT l.id AS "loanId", l."lenderName", l."dueDate", SUM(le."amountKobo")::bigint AS "amountKobo"
        FROM loans l JOIN loan_ledger_entries le ON le."loanId" = l.id
       GROUP BY l.id HAVING SUM(le."amountKobo") > 0`,
    prisma.$queryRaw<Array<{
      kind: "SUPPLIER_PURCHASE" | "LOAN"; id: string; label: string; balanceKobo: bigint; dueDate: string | null;
    }>>`
      SELECT kind, id, label, "balanceKobo", "dueDate" FROM (
        SELECT 'SUPPLIER_PURCHASE'::text AS kind, p.id,
               COALESCE(s.name, 'Supplier') || ' — ' || COALESCE(p.reference, LEFT(p.id, 8)) AS label,
               (p."totalKobo" - p."paidKobo")::bigint AS "balanceKobo", p."dueDate"
          FROM purchases p LEFT JOIN suppliers s ON s.id = p."supplierId"
         WHERE p.status <> 'VOIDED' AND p."supplierId" IS NOT NULL AND p."totalKobo" > p."paidKobo"
        UNION ALL
        SELECT 'LOAN'::text, l.id, l."lenderName" || ' loan',
               SUM(le."amountKobo")::bigint, l."dueDate"
          FROM loans l JOIN loan_ledger_entries le ON le."loanId" = l.id
         GROUP BY l.id HAVING SUM(le."amountKobo") > 0
      ) obligations
      ORDER BY "dueDate" ASC NULLS LAST, id
      LIMIT 50`,
  ]);
  const products: FinancialPositionProductInput[] = stockRows
    .filter((row) => row.warehouseUnits > 0 || row.fridgeUnits > 0)
    .map((row) => ({
      productId: row.productId,
      productName: row.productName,
      warehousePacks: Math.floor(row.warehouseUnits / row.unitsPerPack),
      warehouseLooseUnits: row.warehouseUnits % row.unitsPerPack,
      fridgeUnits: row.fridgeUnits,
      packSizeUnits: row.unitsPerPack,
      retailPriceKobo: row.retailPriceKobo,
      wholesalePriceKobo: row.wholesalePriceKobo,
      averageCostKobo: row.averageCostKobo,
    }));
  const loansOutstandingKobo = loanRows.reduce((sum, row) => sum + row.amountKobo, 0n);
  const supplierPayablesKobo = payableRows.reduce((sum, row) => sum + row.amountKobo, 0n);
  const result = computeFinancialPosition({
    todayLagosDate: today,
    products,
    receivablesKobo: receivableRows[0]?.receivablesKobo ?? 0n,
    cashKobo: cashRows[0]?.cashKobo ?? 0n,
    supplierPayablesKobo,
    loansOutstandingKobo,
    options: {
      stockDiscountBps: query.stockDiscountBps,
      receivablesCollectibleBps: query.receivablesCollectibleBps,
      includeReceivables: query.includeReceivables,
      includeCash: query.includeCash,
    },
    liabilitiesBreakdown: {
      payablesBySupplier: payableRows,
      loansByLender: loanRows.map(({ dueDate: _dueDate, ...row }) => row),
    },
    obligations: obligationRows.map((row) => ({
      ...row,
      balanceKobo: row.balanceKobo,
      dueDate: row.dueDate,
    })),
  });
  const stringify = (value: unknown): unknown => {
    if (typeof value === "bigint") return value.toString();
    if (Array.isArray(value)) return value.map(stringify);
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stringify(item)]));
    }
    return value;
  };
  return {
    asOf: "now",
    selectedScenario: query.scenario,
    selected: stringify(result.scenarios[query.scenario]),
    scenarios: stringify(result.scenarios),
    liabilitiesBreakdown: stringify(result.liabilitiesBreakdown),
    obligations: stringify(result.obligations),
  };
}
