import type { ProductsApi } from "./products.api";
import type { SuppliersApi } from "./suppliers.api";
import type { CustomersApi } from "./customers.api";
import type { PurchasesApi } from "./purchases.api";
import type { SalesApi } from "./sales.api";
import type { StockApi } from "./stock.api";
import type { TransfersApi } from "./transfers.api";
import type { AdjustmentsApi } from "./adjustments.api";
import type { ReportsApi } from "./reports.api";
import type { ExpensesApi } from "./expenses.api";
import { productsMockApi } from "./products.mock";
import { suppliersMockApi } from "./suppliers.mock";
import { customersMockApi } from "./customers.mock";
import { purchasesMockApi } from "./purchases.mock";
import { salesMockApi } from "./sales.mock";
import { stockMockApi } from "./stock.mock";
import { transfersMockApi } from "./transfers.mock";
import { adjustmentsMockApi } from "./adjustments.mock";
import { reportsMockApi } from "./reports.mock";
import { expensesMockApi } from "./expenses.mock";

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
  getById: async () => notImplemented(),
  create: async () => notImplemented(),
  update: async () => notImplemented(),
  softDelete: async () => notImplemented(),
  restore: async () => notImplemented(),
};

const customersRealApi: CustomersApi = {
  list: async () => notImplemented(),
  getById: async () => notImplemented(),
  create: async () => notImplemented(),
  update: async () => notImplemented(),
  softDelete: async () => notImplemented(),
  restore: async () => notImplemented(),
};

const purchasesRealApi: PurchasesApi = {
  list: async () => notImplemented(),
  getById: async () => notImplemented(),
  create: async () => notImplemented(),
  update: async () => notImplemented(),
  void: async () => notImplemented(),
};

const salesRealApi: SalesApi = {
  list: async () => notImplemented(),
  getById: async () => notImplemented(),
  create: async () => notImplemented(),
  update: async () => notImplemented(),
  void: async () => notImplemented(),
  recordPayment: async () => notImplemented(),
};

const stockRealApi: StockApi = {
  list: async () => notImplemented(),
  movements: async () => notImplemented(),
};

const transfersRealApi: TransfersApi = {
  list: async () => notImplemented(),
  getById: async () => notImplemented(),
  create: async () => notImplemented(),
};

const adjustmentsRealApi: AdjustmentsApi = {
  list: async () => notImplemented(),
  getById: async () => notImplemented(),
  create: async () => notImplemented(),
  void: async () => notImplemented(),
};

const reportsRealApi: ReportsApi = {
  salesSummary: async () => notImplemented(),
};

const expensesRealApi: ExpensesApi = {
  list: async () => notImplemented(),
  getById: async () => notImplemented(),
  create: async () => notImplemented(),
  update: async () => notImplemented(),
  remove: async () => notImplemented(),
};

const apiMode = process.env.NEXT_PUBLIC_API_MODE ?? "mock";

if (apiMode !== "mock" && apiMode !== "real") {
  throw new Error(`Unsupported NEXT_PUBLIC_API_MODE '${apiMode}'.`);
}

export const productsApi = apiMode === "mock" ? productsMockApi : productsRealApi;
export const suppliersApi = apiMode === "mock" ? suppliersMockApi : suppliersRealApi;
export const customersApi = apiMode === "mock" ? customersMockApi : customersRealApi;
export const purchasesApi = apiMode === "mock" ? purchasesMockApi : purchasesRealApi;
export const salesApi = apiMode === "mock" ? salesMockApi : salesRealApi;
export const stockApi = apiMode === "mock" ? stockMockApi : stockRealApi;
export const transfersApi = apiMode === "mock" ? transfersMockApi : transfersRealApi;
export const adjustmentsApi = apiMode === "mock" ? adjustmentsMockApi : adjustmentsRealApi;
export const reportsApi = apiMode === "mock" ? reportsMockApi : reportsRealApi;
export const expensesApi = apiMode === "mock" ? expensesMockApi : expensesRealApi;

export { resetDemoData } from "./mock-store";
export type { ProductsApi } from "./products.api";
export type { SuppliersApi } from "./suppliers.api";
export type { CustomersApi } from "./customers.api";
export type { PurchasesApi } from "./purchases.api";
export type { SalesApi } from "./sales.api";
export type { StockApi } from "./stock.api";
export type { TransfersApi } from "./transfers.api";
export type { AdjustmentsApi } from "./adjustments.api";
export type { ReportsApi } from "./reports.api";
export type { ExpensesApi } from "./expenses.api";
