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
  },
};
