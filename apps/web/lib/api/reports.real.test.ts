import { describe, expect, it } from "vitest";
import { ApiError } from "./client";
import {
  buildReportQuery,
  mapFinancialPosition,
  mapMoneyFlow,
  reportPaths,
} from "./reports.real";
import {
  dashboardResponseSchema,
  financialPositionResponseSchema,
  moneyFlowResponseSchema,
  parseReportResponse,
  productSalesResponseSchema,
  salesSummaryResponseSchema,
  UNEXPECTED_RESPONSE_MESSAGE,
} from "./reports.schemas";

describe("exact query strings", () => {
  it("sales summary omits an unset channel", () => {
    expect(reportPaths.salesSummary({ from: "2026-01-01", to: "2026-01-31" })).toBe(
      "/reports/sales-summary?from=2026-01-01&to=2026-01-31",
    );
  });

  it("sales summary sends a set channel", () => {
    expect(
      reportPaths.salesSummary({
        from: "2026-01-01",
        to: "2026-01-31",
        channel: "RETAIL",
      }),
    ).toBe("/reports/sales-summary?from=2026-01-01&to=2026-01-31&channel=RETAIL");
  });

  it("dashboard with and without a date", () => {
    expect(reportPaths.dashboard("2026-01-31")).toBe(
      "/reports/dashboard?date=2026-01-31",
    );
    expect(reportPaths.dashboard()).toBe("/reports/dashboard");
  });

  it("product sales sends limit as plain digits and omits unset channel", () => {
    expect(
      reportPaths.productSales({ from: "2026-01-01", to: "2026-01-31", limit: 20 }),
    ).toBe("/reports/product-sales?from=2026-01-01&to=2026-01-31&limit=20");
    expect(
      reportPaths.productSales({
        from: "2026-01-01",
        to: "2026-01-31",
        channel: "WHOLESALE",
        limit: 100,
      }),
    ).toBe(
      "/reports/product-sales?from=2026-01-01&to=2026-01-31&channel=WHOLESALE&limit=100",
    );
  });

  it("money flow omits an unset account", () => {
    expect(reportPaths.moneyFlow("2026-01-01", "2026-01-31")).toBe(
      "/reports/money-flow?from=2026-01-01&to=2026-01-31",
    );
    expect(reportPaths.moneyFlow("2026-01-01", "2026-01-31", "acc1")).toBe(
      "/reports/money-flow?from=2026-01-01&to=2026-01-31&accountId=acc1",
    );
  });

  it("financial position sends booleans as true/false and bps as digits", () => {
    expect(
      reportPaths.financialPosition({
        stockDiscountBps: 8750,
        receivablesCollectibleBps: 0,
        includeReceivables: true,
        includeCash: false,
      }),
    ).toBe(
      "/reports/financial-position?stockDiscountBps=8750&receivablesCollectibleBps=0&includeReceivables=true&includeCash=false",
    );
    expect(reportPaths.financialPosition({}, "FLOOR")).toBe(
      "/reports/financial-position?scenario=FLOOR",
    );
    expect(reportPaths.financialPosition()).toBe("/reports/financial-position");
  });

  it("refuses a non-integer number", () => {
    expect(() => buildReportQuery({ limit: 1.5 })).toThrow(RangeError);
  });
});

const column = (value: string) => value;

describe("money flow mapping", () => {
  // Amounts in comments are naira; fixture values are kobo (x100).
  // BANK opens 100000. SALE_PAYMENT in 50000. Reversal of a payment posts SALE_PAYMENT out 20000.
  // LOAN_REPAYMENT out 25000 (principal 21000 + interest 4000 in ONE outflow; no interest line).
  // EXPENSE:RENT out 10000. In 50000; out 20000+25000+10000 = 55000; net -5000; closing 95000.
  // Cash received from sales = 50000 - 20000 = 30000.
  const fixture = {
    from: "2026-01-01",
    to: "2026-01-31",
    rows: [
      {
        accountId: "bank",
        accountName: "ZZTEST Bank",
        accountType: "BANK",
        openingBalanceKobo: column("10000000"),
        moneyInKobo: column("5000000"),
        moneyOutKobo: column("5500000"),
        netKobo: column("-500000"),
        closingBalanceKobo: column("9500000"),
        categories: [
          { key: "SALE_PAYMENT", moneyInKobo: "5000000", moneyOutKobo: "2000000" },
          { key: "LOAN_REPAYMENT", moneyInKobo: "0", moneyOutKobo: "2500000" },
          { key: "EXPENSE:RENT", moneyInKobo: "0", moneyOutKobo: "1000000" },
        ],
      },
    ],
    totals: {
      openingBalanceKobo: "10000000",
      moneyInKobo: "5000000",
      moneyOutKobo: "5500000",
      netKobo: "-500000",
      closingBalanceKobo: "9500000",
    },
    transfers: { moneyInKobo: "0", moneyOutKobo: "0" },
    sales: {
      salesBilledKobo: "8000000",
      cashReceivedFromSalesKobo: "3000000",
      debtsFromRangeSalesKobo: "5000000",
      debtsOwedNowKobo: "5000000",
    },
  };

  it("renames sales fields and flags totals as excluding transfers", () => {
    const dto = mapMoneyFlow(moneyFlowResponseSchema.parse(fixture));
    expect(dto.totalsExcludeTransfers).toBe(true);
    expect(dto.sales.billedKobo).toBe("8000000");
    expect(dto.sales.customerMoneyReceivedKobo).toBe("3000000");
    expect(dto.sales.debtOutstandingKobo).toBe("5000000");
    expect(dto.totals.closingBalanceKobo).toBe("9500000");
  });

  it("shows a reversed payment as money out on SALE_PAYMENT and interest only inside the repayment", () => {
    const dto = mapMoneyFlow(moneyFlowResponseSchema.parse(fixture));
    const categories = dto.rows[0].categories;
    expect(categories.find((c) => c.key === "SALE_PAYMENT")?.moneyOutKobo).toBe(
      "2000000",
    );
    expect(categories.some((c) => c.key.includes("LOAN_INTEREST"))).toBe(false);
    // 2500000 is the full repayment, not repayment + interest.
    expect(categories.find((c) => c.key === "LOAN_REPAYMENT")?.moneyOutKobo).toBe(
      "2500000",
    );
  });
});

describe("financial position mapping", () => {
  // Stock 1,000,000 + debtors 400,000 + cash 300,000 = 1,700,000 assets (EXPECTED, no discount).
  // Liabilities: supplier 500,000 + loan 600,000 = 1,100,000. Net 600,000.
  // Coverage = 1,700,000 / 1,100,000 = 15454 bps (rounded down by the server).
  // Stock only: 1,000,000 / 1,100,000 = 9090 bps; stock-only net = -100,000.
  const scenario = (name: "EXPECTED" | "BEST" | "FLOOR") => ({
    scenario: name,
    stockValueKobo: "1000000",
    receivablesKobo: "400000",
    cashKobo: "300000",
    totalAssetsKobo: "1700000",
    totalLiabilitiesKobo: "1100000",
    netPositionKobo: "600000",
    canClearAll: true,
    coverageBps: 15454,
    stockOnlyCoverageBps: 9090,
    stockOnlyNetKobo: "-100000",
  });
  const fixture = {
    asOf: "now",
    selectedScenario: "EXPECTED",
    selected: scenario("EXPECTED"),
    scenarios: {
      EXPECTED: scenario("EXPECTED"),
      BEST: scenario("BEST"),
      FLOOR: scenario("FLOOR"),
    },
    liabilitiesBreakdown: {
      payablesBySupplier: [
        { supplierId: "s1", supplierName: "ZZTEST Supplier", amountKobo: "500000" },
      ],
      loansByLender: [
        { loanId: "l1", lenderName: "ZZTEST Lender", amountKobo: "600000" },
      ],
    },
    obligations: [
      {
        kind: "LOAN",
        id: "l1",
        label: "ZZTEST Lender",
        balanceKobo: "600000",
        dueDate: "2026-01-01",
        urgency: "OVERDUE",
      },
      {
        kind: "SUPPLIER_PURCHASE",
        id: "p1",
        label: "ZZTEST Supplier",
        balanceKobo: "500000",
        dueDate: null,
        urgency: "LATER",
      },
    ],
  };

  it("converts kobo strings to bigint and keeps bps and urgency", () => {
    const result = mapFinancialPosition(
      financialPositionResponseSchema.parse(fixture),
    );
    expect(result.scenarios.EXPECTED.cashKobo).toBe(300000n);
    expect(result.scenarios.EXPECTED.stockOnlyNetKobo).toBe(-100000n);
    expect(result.scenarios.EXPECTED.coverageBps).toBe(15454);
    expect(result.liabilitiesBreakdown.loansByLender[0].amountKobo).toBe(600000n);
    expect(result.obligations.map((o) => o.urgency)).toEqual(["OVERDUE", "LATER"]);
    expect(result.obligations[1].dueDate).toBeNull();
  });

  it("keeps null coverage when there are no liabilities", () => {
    const empty = {
      ...fixture,
      selected: { ...scenario("EXPECTED"), coverageBps: null, stockOnlyCoverageBps: null },
      scenarios: {
        ...fixture.scenarios,
        EXPECTED: { ...scenario("EXPECTED"), coverageBps: null, stockOnlyCoverageBps: null },
      },
    };
    const result = mapFinancialPosition(financialPositionResponseSchema.parse(empty));
    expect(result.scenarios.EXPECTED.coverageBps).toBeNull();
  });
});

describe("runtime response validation", () => {
  const salesTotals = Object.fromEntries(
    ["retail", "wholesale", "total"].flatMap((p) =>
      [
        "SupposedRevenue",
        "RevenueGotten",
        "StandardRevenue",
        "Revenue",
        "Cogs",
        "GrossProfit",
        "Expenses",
        "NetProfit",
      ].map((m) => [`${p}${m}Kobo`, "0"]),
    ),
  );

  it("accepts a valid sales summary and ignores extra fields", () => {
    const parsed = parseReportResponse(
      salesSummaryResponseSchema,
      {
        days: [{ date: "2026-01-01", ...salesTotals }],
        totals: salesTotals,
        from: "2026-01-01",
        to: "2026-01-01",
        channel: null,
        extra: true,
      },
      "sales-summary",
    );
    expect(parsed.days).toHaveLength(1);
  });

  it("rejects a float kobo value with the friendly error", () => {
    const bad = { ...salesTotals, totalNetProfitKobo: "12.5" };
    expect(() =>
      parseReportResponse(
        salesSummaryResponseSchema,
        { days: [], totals: bad, from: "2026-01-01", to: "2026-01-01", channel: null },
        "sales-summary",
      ),
    ).toThrow(ApiError);
    try {
      parseReportResponse(
        salesSummaryResponseSchema,
        { days: [], totals: bad, from: "2026-01-01", to: "2026-01-01", channel: null },
        "sales-summary",
      );
    } catch (error) {
      expect((error as ApiError).userMessage).toBe(UNEXPECTED_RESPONSE_MESSAGE);
    }
  });

  it("rejects missing sections for each endpoint", () => {
    for (const schema of [
      dashboardResponseSchema,
      productSalesResponseSchema,
      moneyFlowResponseSchema,
      financialPositionResponseSchema,
    ]) {
      expect(() => parseReportResponse(schema as never, {}, "x")).toThrow(ApiError);
    }
  });
});
