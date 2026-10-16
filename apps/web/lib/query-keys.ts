export const queryKeys = {
  products: {
    all: ["products"] as const,
    list: (search: string, includeDeleted: boolean) =>
      ["products", "list", search, includeDeleted] as const,
  },
  suppliers: {
    all: ["suppliers"] as const,
    list: (search: string, includeDeleted: boolean) =>
      ["suppliers", "list", search, includeDeleted] as const,
    detail: (id: string) => ["suppliers", "detail", id] as const,
  },
  purchases: {
    all: ["purchases"] as const,
    list: ["purchases", "list"] as const,
    detail: (id: string) => ["purchases", "detail", id] as const,
  },
  sales: {
    all: ["sales"] as const,
    list: ["sales", "list"] as const,
    detail: (id: string) => ["sales", "detail", id] as const,
  },
  customers: {
    all: ["customers"] as const,
    list: (search: string, includeDeleted: boolean) =>
      ["customers", "list", search, includeDeleted] as const,
    detail: (id: string) => ["customers", "detail", id] as const,
  },
  reports: {
    all: ["reports"] as const,
    salesSummary: (from: string, to: string) =>
      ["reports", "sales-summary", from, to] as const,
  },
  expenses: {
    all: ["expenses"] as const,
    list: (from?: string, to?: string) =>
      ["expenses", "list", from ?? "", to ?? ""] as const,
    detail: (id: string) => ["expenses", "detail", id] as const,
  },
  stock: {
    all: ["stock"] as const,
    list: ["stock", "list"] as const,
    movements: (filter: {
      productId?: string;
      location?: string;
      type?: string;
    }) => ["stock", "movements", filter] as const,
  },
  transfers: {
    all: ["transfers"] as const,
    list: ["transfers", "list"] as const,
    detail: (id: string) => ["transfers", "detail", id] as const,
  },
  adjustments: {
    all: ["adjustments"] as const,
    list: ["adjustments", "list"] as const,
    detail: (id: string) => ["adjustments", "detail", id] as const,
  },
  dashboard: {
    all: ["dashboard"] as const,
  },
  payables: {
    all: ["payables"] as const,
    outstanding: ["payables", "outstanding"] as const,
  },
  loans: {
    all: ["loans"] as const,
    list: ["loans", "list"] as const,
    detail: (id: string) => ["loans", "detail", id] as const,
  },
  cash: {
    all: ["cash"] as const,
    latest: ["cash", "latest"] as const,
  },
  accounting: {
    all: ["accounting"] as const,
    position: (options: unknown) => ["accounting", "position", options] as const,
  },
};
