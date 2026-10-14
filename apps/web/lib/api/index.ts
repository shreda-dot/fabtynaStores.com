import type { ProductsApi } from "./products.api";
import type { SuppliersApi } from "./suppliers.api";
import { productsMockApi } from "./products.mock";
import { suppliersMockApi } from "./suppliers.mock";

function notImplemented(): never {
  throw new Error("not implemented");
}

const productsRealApi: ProductsApi = {
  list: async () => notImplemented(),
  create: async () => notImplemented(),
  update: async () => notImplemented(),
  softDelete: async () => notImplemented(),
  restore: async () => notImplemented(),
};

const suppliersRealApi: SuppliersApi = {
  list: async () => notImplemented(),
  create: async () => notImplemented(),
  update: async () => notImplemented(),
  softDelete: async () => notImplemented(),
  restore: async () => notImplemented(),
};

const apiMode = process.env.NEXT_PUBLIC_API_MODE ?? "mock";

if (apiMode !== "mock" && apiMode !== "real") {
  throw new Error(`Unsupported NEXT_PUBLIC_API_MODE '${apiMode}'.`);
}

export const productsApi = apiMode === "mock" ? productsMockApi : productsRealApi;
export const suppliersApi = apiMode === "mock" ? suppliersMockApi : suppliersRealApi;

export { resetDemoData } from "./mock-store";
export type { ProductsApi } from "./products.api";
export type { SuppliersApi } from "./suppliers.api";
