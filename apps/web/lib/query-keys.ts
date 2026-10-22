const apiMode = process.env.NEXT_PUBLIC_API_MODE ?? "mock";

function key<const T extends readonly unknown[]>(
  ...parts: T
): readonly [string, ...T] {
  return [apiMode, ...parts];
}

export const queryKeys = {
  products: {
    all: key("products"),
    list: (search: string, includeDeleted: boolean) =>
      key("products", "list", search, includeDeleted),
    // Infinite (paged) data has a different cache shape than list(); never share a key.
    pages: (search: string, includeDeleted: boolean) =>
      key("products", "pages", search, includeDeleted),
    detail: (id: string) => key("products", "detail", id),
  },
  suppliers: {
    all: key("suppliers"),
    list: (search: string, includeDeleted: boolean, balanceFilter = "all") =>
      key("suppliers", "list", search, includeDeleted, balanceFilter),
    pages: (search: string, includeDeleted: boolean, balanceFilter = "all") =>
      key("suppliers", "pages", search, includeDeleted, balanceFilter),
    detail: (id: string) => key("suppliers", "detail", id),
  },
  purchases: {
    all: key("purchases"),
    list: key("purchases", "list"),
    page: (filters: unknown) => key("purchases", "page", filters),
    detail: (id: string) => key("purchases", "detail", id),
  },
  sales: {
    all: key("sales"),
    list: key("sales", "list"),
    page: (filters: unknown) => key("sales", "page", filters),
    detail: (id: string) => key("sales", "detail", id),
  },
  customers: {
    all: key("customers"),
    list: (search: string, includeDeleted: boolean, balanceFilter = "all") =>
      key("customers", "list", search, includeDeleted, balanceFilter),
    pages: (search: string, includeDeleted: boolean, balanceFilter = "all") =>
      key("customers", "pages", search, includeDeleted, balanceFilter),
    detail: (id: string) => key("customers", "detail", id),
  },
  reports: {
    all: key("reports"),
    salesSummary: (from: string, to: string, channel: string | null = null) =>
      key("reports", "sales-summary", from, to, channel ?? "ALL"),
    dashboard: (date: string) => key("reports", "dashboard", date),
    productSales: (
      from: string,
      to: string,
      channel: string | null,
      limit: number,
    ) => key("reports", "product-sales", from, to, channel ?? "ALL", limit),
    moneyFlow: (from: string, to: string, accountId: string | null) =>
      key("reports", "money-flow", from, to, accountId ?? "ALL"),
    financialPosition: (options: {
      scenario: string | null;
      stockDiscountBps: number | null;
      receivablesCollectibleBps: number | null;
      includeReceivables: boolean;
      includeCash: boolean;
    }) => key("reports", "financial-position", options),
  },
  expenses: {
    all: key("expenses"),
    list: (filters: unknown) => key("expenses", "list", filters),
    // Infinite (paged) data has a different cache shape than list(); never share a key.
    pages: (filters: unknown) => key("expenses", "pages", filters),
    summary: (filters: unknown) => key("expenses", "summary", filters),
    // Active-only and all-categories are different arrays; keep separate caches.
    categories: (includeInactive: boolean) =>
      key("expenses", "categories", includeInactive ? "all" : "active"),
    detail: (id: string) => key("expenses", "detail", id),
  },
  stock: {
    all: key("stock"),
    list: key("stock", "list"),
    movements: (filter: {
      productId?: string;
      location?: string;
      type?: string;
    }) => key("stock", "movements", filter),
  },
  transfers: {
    all: key("transfers"),
    list: key("transfers", "list"),
    detail: (id: string) => key("transfers", "detail", id),
  },
  adjustments: {
    all: key("adjustments"),
    list: key("adjustments", "list"),
    detail: (id: string) => key("adjustments", "detail", id),
  },
  dashboard: {
    all: key("dashboard"),
  },
  payables: {
    all: key("payables"),
    outstanding: key("payables", "outstanding"),
    list: (search: string, overdueOnly: boolean) =>
      key("payables", "list", search, overdueOnly),
  },
  debtors: {
    all: key("debtors"),
    list: (search: string, minBalanceKobo?: string) =>
      key("debtors", "list", search, minBalanceKobo ?? ""),
  },
  loans: {
    all: key("loans"),
    list: key("loans", "list"),
    detail: (id: string) => key("loans", "detail", id),
    pages: (filters: unknown) => key("loans", "pages", filters),
  },
  cash: {
    all: key("cash"),
    latest: key("cash", "latest"),
  },
  accounting: {
    all: key("accounting"),
    migrationNotice: key("accounting", "migration-notice"),
    accounts: key("accounting", "accounts"),
    accountLedger: (id: string, from?: string, to?: string) =>
      key("accounting", "account-ledger", id, from ?? "", to ?? ""),
    accountBalances: key("accounting", "account-balances"),
  },
};
