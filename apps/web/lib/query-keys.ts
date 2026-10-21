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
    salesSummary: (from: string, to: string) =>
      key("reports", "sales-summary", from, to),
  },
  expenses: {
    all: key("expenses"),
    list: (from?: string, to?: string) =>
      key("expenses", "list", from ?? "", to ?? ""),
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
  },
  cash: {
    all: key("cash"),
    latest: key("cash", "latest"),
  },
  accounting: {
    all: key("accounting"),
    position: (options: unknown) => key("accounting", "position", options),
    accounts: key("accounting", "accounts"),
    migrationNotice: key("accounting", "migration-notice"),
    accountLedger: (id: string, from?: string, to?: string) =>
      key("accounting", "account-ledger", id, from ?? "", to ?? ""),
    moneyFlow: (from: string, to: string, accountId: string) =>
      key("accounting", "money-flow", from, to, accountId),
    accountBalances: key("accounting", "account-balances"),
  },
};
