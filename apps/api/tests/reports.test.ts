import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { performance } from "node:perf_hooks";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  accountBalanceOf,
  call,
  createHarness,
  newId,
  postSale,
  saleBody,
  seedAccount,
  seedCustomer,
  seedProduct,
  type Harness,
} from "./sales-fixtures.js";

const today = "2026-10-15";
const yesterday = "2026-10-14";
const fixedNow = new Date("2026-10-15T12:00:00.000Z");

let h!: Harness;

vi.setConfig({ testTimeout: 180_000 });

type QueryMetric = { statements: number; rows: number; databaseMs: number };
let activeMetric: QueryMetric | null = null;

const reportModels = new Set([
  "account",
  "accountLedgerEntry",
  "customerLedgerEntry",
  "expense",
  "product",
  "sale",
  "saleLine",
  "salePayment",
]);

function instrumentPrisma(prisma: PrismaClient): PrismaClient {
  const measure = async (operation: () => unknown) => {
    if (activeMetric === null) return operation();
    activeMetric.statements += 1;
    const started = performance.now();
    try {
      const result = await operation();
      activeMetric.rows += Array.isArray(result)
        ? result.length
        : typeof result === "object" && result !== null && "count" in result
          ? Number(result.count)
          : 0;
      return result;
    } finally {
      activeMetric.databaseMs += performance.now() - started;
    }
  };
  return new Proxy(prisma, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (reportModels.has(String(property)) && typeof value === "object" && value !== null) {
        return new Proxy(value, {
          get(delegate, operation) {
            const member = Reflect.get(delegate, operation, delegate);
            return typeof member === "function"
              ? (...args: unknown[]) => measure(() => member.apply(delegate, args))
              : member;
          },
        });
      }
      if (property === "$queryRaw" && typeof value === "function") {
        return (...args: unknown[]) => measure(() => value.apply(target, args));
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

beforeAll(async () => {
  h = await createHarness({ now: () => fixedNow, wrapPrisma: instrumentPrisma });
});

afterAll(async () => {
  await h.close();
});

async function reportCall(label: string, url: string) {
  const metric: QueryMetric = { statements: 0, rows: 0, databaseMs: 0 };
  const started = performance.now();
  activeMetric = metric;
  try {
    const response = await call(h.app, "GET", url);
    console.log(`REPORT_METRIC ${label} ${JSON.stringify({
      ...metric,
      elapsedMs: Math.round(performance.now() - started),
    })}`);
    return response;
  } finally {
    activeMetric = null;
  }
}

describe("read-only reports", () => {
  it("captures plans for the main report aggregation queries", async () => {
    const start = new Date("2026-10-14T23:00:00.000Z");
    const end = new Date("2026-10-16T23:00:00.000Z");
    const queries = [
      {
        name: "product-sales",
        sql: `SELECT p.id AS "productId", p.name AS "productName",
                     SUM(sl."quantityUnits")::text AS "unitsSold",
                     SUM(sl."lineTotalKobo")::text AS "billedRevenueKobo",
                     SUM(sl."costPerUnitKobo" * sl."quantityUnits")::text AS "cogsKobo"
                FROM sales s
                JOIN sale_lines sl ON sl."saleId" = s.id
                JOIN products p ON p.id = sl."productId"
               WHERE s.status <> 'VOIDED' AND s."soldAt" >= $1 AND s."soldAt" < $2
               GROUP BY p.id, p.name
               ORDER BY SUM(sl."lineTotalKobo") DESC, p.name, p.id
               LIMIT 20`,
        values: [start, end],
      },
      {
        name: "current-stock",
        sql: `SELECT p.id, p."unitsPerPack", p."retailPriceKobo", p."wholesalePriceKobo",
                     p."averageCostKobo",
                     COALESCE(jsonb_object_agg(sb.location::text, sb."quantityUnits")
                       FILTER (WHERE sb.location IS NOT NULL), '{}'::jsonb) AS locations
                FROM products p
                LEFT JOIN stock_balances sb ON sb."productId" = p.id
               GROUP BY p.id`,
        values: [],
      },
      {
        name: "financial-position-stock",
        sql: `SELECT p.id AS "productId", p.name AS "productName", p."unitsPerPack",
                     COALESCE(SUM(sb."quantityUnits") FILTER (WHERE sb.location = 'WAREHOUSE'), 0)::int AS "warehouseUnits",
                     COALESCE(SUM(sb."quantityUnits") FILTER (WHERE sb.location IN ('RETAIL_SHELF', 'MARKET')), 0)::int AS "fridgeUnits",
                     p."retailPriceKobo", p."wholesalePriceKobo", p."averageCostKobo"
                FROM products p LEFT JOIN stock_balances sb ON sb."productId" = p.id
               GROUP BY p.id`,
        values: [],
      },
      {
        name: "ledger-receivables",
        sql: `SELECT COALESCE(SUM(balance), 0)::bigint AS "receivablesKobo"
                FROM (SELECT SUM("amountKobo") AS balance
                        FROM customer_ledger_entries
                       GROUP BY "customerId"
                      HAVING SUM("amountKobo") > 0) balances`,
        values: [],
      },
    ];

    for (const query of queries) {
      const result = await h.pg.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.sql}`,
        query.values,
      );
      const explain = result.rows[0]["QUERY PLAN"][0] as {
        "Planning Time": number;
        "Execution Time": number;
        Plan: {
          "Node Type": string;
          "Actual Rows": number;
          "Shared Hit Blocks"?: number;
          "Shared Read Blocks"?: number;
          Plans?: Array<{ "Node Type": string; "Relation Name"?: string; "Index Name"?: string }>;
        };
      };
      console.log(`REPORT_EXPLAIN ${query.name} ${JSON.stringify({
        planningMs: explain["Planning Time"],
        executionMs: explain["Execution Time"],
        rootNode: explain.Plan["Node Type"],
        rootRows: explain.Plan["Actual Rows"],
        hitBlocks: explain.Plan["Shared Hit Blocks"] ?? 0,
        readBlocks: explain.Plan["Shared Read Blocks"] ?? 0,
        childNodes: explain.Plan.Plans?.map((node) => ({
          node: node["Node Type"],
          relation: node["Relation Name"] ?? null,
          index: node["Index Name"] ?? null,
        })) ?? [],
      })}`);
    }
  });

  it("uses payment dates for sales summary and yesterday/today dashboard comparisons", async () => {
    const baselineSummary = await reportCall("sales-summary-baseline", "/reports/sales-summary");
    const baselineDashboard = await reportCall("dashboard-baseline", "/reports/dashboard");
    expect(baselineSummary.status).toBe(200);
    expect(baselineDashboard.status).toBe(200);
    const product = await seedProduct(h.pg, { stock: 20 });
    const customer = await seedCustomer(h.pg);
    const account = await seedAccount(h.pg);
    const sale = await postSale(
      h.app,
      saleBody({
        productId: product.id,
        quantity: 2,
        customerId: customer.id,
        soldAt: `${today}T08:00:00.000Z`,
        reference: newId("report-summary"),
      }),
    );
    expect(sale.status).toBe(201);

    const payment = await call(h.app, "POST", `/sales/${sale.body.id}/payments`, {
      amountKobo: "5000",
      accountId: account.id,
      paidAt: `${today}T09:00:00.000Z`,
    });
    expect(payment.status).toBe(201);

    const summary = await reportCall("sales-summary", "/reports/sales-summary");
    expect(summary.status).toBe(200);
    expect(summary.body.from).toBe(today);
    expect(BigInt(summary.body.totals.totalSupposedRevenueKobo)).toBe(
      BigInt(baselineSummary.body.totals.totalSupposedRevenueKobo) + 20000n,
    );
    expect(BigInt(summary.body.totals.totalRevenueGottenKobo)).toBe(
      BigInt(baselineSummary.body.totals.totalRevenueGottenKobo) + 5000n,
    );
    expect(summary.body.days).toHaveLength(1);
    expect(summary.body.days[0].date).toBe(today);

    const dashboard = await reportCall("dashboard", "/reports/dashboard");
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.date).toBe(today);
    expect(BigInt(dashboard.body.metrics.revenueGottenKobo.value)).toBe(
      BigInt(baselineDashboard.body.metrics.revenueGottenKobo.value) + 5000n,
    );
    expect(BigInt(dashboard.body.metrics.debtKobo.value)).toBe(
      BigInt(baselineDashboard.body.metrics.debtKobo.value) + 15000n,
    );
    expect(dashboard.body.metrics.debtKobo.yesterday).toBe(
      baselineDashboard.body.metrics.debtKobo.yesterday,
    );
    expect(BigInt(dashboard.body.channels.RETAIL.supposedKobo)).toBe(
      BigInt(baselineDashboard.body.channels.RETAIL.supposedKobo) + 20000n,
    );
    expect(BigInt(dashboard.body.channels.RETAIL.gottenKobo)).toBe(
      BigInt(baselineDashboard.body.channels.RETAIL.gottenKobo) + 5000n,
    );
    expect(BigInt(dashboard.body.channels.RETAIL.debtKobo)).toBe(
      BigInt(baselineDashboard.body.channels.RETAIL.debtKobo) + 15000n,
    );
  });

  it("excludes reversed payments from sales summary and dates their reversal in Money Flow", async () => {
    const baselineSummary = await reportCall(
      "sales-summary-baseline-reversal",
      `/reports/sales-summary?from=${yesterday}&to=${today}`,
    );
    expect(baselineSummary.status).toBe(200);
    const product = await seedProduct(h.pg, { stock: 10 });
    const customer = await seedCustomer(h.pg);
    const account = await seedAccount(h.pg);
    const sale = await postSale(
      h.app,
      saleBody({
        productId: product.id,
        quantity: 1,
        customerId: customer.id,
        soldAt: `${yesterday}T08:00:00.000Z`,
        reference: newId("report-reversal"),
      }),
    );
    expect(sale.status).toBe(201);

    const payment = await call(h.app, "POST", `/sales/${sale.body.id}/payments`, {
      amountKobo: "3000",
      accountId: account.id,
      paidAt: `${yesterday}T09:00:00.000Z`,
    });
    expect(payment.status).toBe(201);
    const reversed = await call(
      h.app,
      "POST",
      `/sales/${sale.body.id}/payments/${payment.body.payment.id}/reverse`,
      { reason: "Report test reversal", reversedAt: `${today}T09:00:00.000Z` },
    );
    expect(reversed.status).toBe(201);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(0n);

    const summary = await reportCall(
      "sales-summary-reversed",
      `/reports/sales-summary?from=${yesterday}&to=${today}`,
    );
    expect(summary.status).toBe(200);
    expect(summary.body.totals.totalRevenueGottenKobo).toBe(
      baselineSummary.body.totals.totalRevenueGottenKobo,
    );

    const priorFlow = await reportCall(
      "money-flow",
      `/reports/money-flow?from=${yesterday}&to=${yesterday}&accountId=${account.id}`,
    );
    const reversalFlow = await reportCall(
      "money-flow-reversal",
      `/reports/money-flow?from=${today}&to=${today}&accountId=${account.id}`,
    );
    expect(priorFlow.status).toBe(200);
    expect(priorFlow.body.sales.cashReceivedFromSalesKobo).toBe("3000");
    expect(reversalFlow.status).toBe(200);
    expect(reversalFlow.body.sales.cashReceivedFromSalesKobo).toBe("-3000");
    expect(reversalFlow.body.rows[0].moneyOutKobo).toBe("3000");
  });

  it("excludes voided sale lines from product sales", async () => {
    const product = await seedProduct(h.pg, { stock: 10 });
    const customer = await seedCustomer(h.pg);
    const liveSale = await postSale(
      h.app,
      saleBody({
        productId: product.id,
        quantity: 2,
        customerId: customer.id,
        soldAt: `${today}T08:00:00.000Z`,
        reference: newId("report-product-live"),
      }),
    );
    const voidedSale = await postSale(
      h.app,
      saleBody({
        productId: product.id,
        quantity: 3,
        customerId: customer.id,
        soldAt: `${today}T09:00:00.000Z`,
        reference: newId("report-product-void"),
      }),
    );
    expect(liveSale.status).toBe(201);
    expect(voidedSale.status).toBe(201);

    const voidResponse = await call(h.app, "POST", `/sales/${voidedSale.body.id}/void`, {});
    expect(voidResponse.status).toBe(200);

    const report = await reportCall("product-sales", `/reports/product-sales?from=${today}&to=${today}`);
    expect(report.status).toBe(200);
    const productResult = report.body.items.find((item: { productId: string }) => item.productId === product.id);
    expect(productResult).toBeDefined();
    expect(productResult.unitsSold).toBe("2");
    expect(productResult.billedRevenueKobo).toBe("20000");
  });

  it("uses ledger cash and includes MARKET stock in financial position", async () => {
    const product = await seedProduct(h.pg, {
      stock: 5,
      location: "MARKET",
      averageCostKobo: 500n,
    });
    const account = await seedAccount(h.pg);
    await h.pg.query(
      `INSERT INTO account_ledger_entries (id, "accountId", type, "amountKobo")
       VALUES ($1, $2, 'OWNER_CAPITAL', 7000::bigint)`,
      [newId("report-capital"), account.id],
    );

    const position = await reportCall("financial-position", "/reports/financial-position?scenario=EXPECTED");
    expect(position.status).toBe(200);
    expect(position.body.asOf).toBe("now");
    expect(position.body.selectedScenario).toBe("EXPECTED");
    expect(position.body.selected.cashKobo).toMatch(/^\d+$/);
    expect(BigInt(position.body.selected.cashKobo)).toBeGreaterThanOrEqual(7000n);
    expect(position.body.selected.stockValueKobo).toMatch(/^\d+$/);
    expect(BigInt(position.body.selected.stockValueKobo)).toBeGreaterThan(0n);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(7000n);
    expect(product.id).not.toBe("");
  });
      it("does not add old-debt collections to today's profit", async () => {
    type SummaryBody = { days?: Array<Record<string, string>> };
    const range = `from=${yesterday}&to=${today}`;
    const baseline = await reportCall("sales-summary-old-debt-baseline", `/reports/sales-summary?${range}`);
    expect(baseline.status).toBe(200);
    const product = await seedProduct(h.pg, { stock: 5, averageCostKobo: 6000n });
    const customer = await seedCustomer(h.pg);
    const account = await seedAccount(h.pg);
    // One unit sold on credit yesterday: price 10000, cost 6000, so margin 4000.
    const sale = await postSale(
      h.app,
      saleBody({
        productId: product.id,
        quantity: 1,
        customerId: customer.id,
        soldAt: `${yesterday}T08:00:00.000Z`,
        reference: newId("report-old-debt"),
      }),
    );
    expect(sale.status).toBe(201);
    // The customer pays the whole debt today.
    const paid = await call(h.app, "POST", `/sales/${sale.body.id}/payments`, {
      amountKobo: "10000",
      accountId: account.id,
      paidAt: `${today}T09:00:00.000Z`,
    });
    expect(paid.status).toBe(201);

    const summary = await reportCall("sales-summary-old-debt", `/reports/sales-summary?${range}`);
    expect(summary.status).toBe(200);
    const value = (body: SummaryBody, date: string, key: string): bigint =>
      BigInt(body.days?.find((day) => day.date === date)?.[key] ?? "0");
    const gained = (date: string, key: string): bigint =>
      value(summary.body as SummaryBody, date, key) -
      value(baseline.body as SummaryBody, date, key);

    // Yesterday's sale is now fully paid: its margin (10000 - 6000) belongs to yesterday.
    expect(gained(yesterday, "totalGrossProfitKobo")).toBe(4000n);
    expect(gained(yesterday, "totalRevenueGottenKobo")).toBe(0n);
    // Today gets the cash but no profit from it.
    expect(gained(today, "totalGrossProfitKobo")).toBe(0n);
    expect(gained(today, "totalRevenueGottenKobo")).toBe(10000n);
  });
  it("rejects reversed and overlong date ranges", async () => {
    const reversed = await call(
      h.app,
      "GET",
      `/reports/sales-summary?from=${today}&to=${yesterday}`,
    );
    const tooLong = await call(
      h.app,
      "GET",
      "/reports/product-sales?from=2025-10-14&to=2026-10-15",
    );
    expect(reversed.status).toBe(400);
    expect(tooLong.status).toBe(400);
  });
});
