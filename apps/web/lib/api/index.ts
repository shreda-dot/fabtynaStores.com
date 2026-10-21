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
import type { PayablesApi } from "./payables.api";
import type { LoansApi } from "./loans.api";
import type { CashApi } from "./cash.api";
import type { AccountingApi } from "./accounting.api";
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
import { payablesMockApi } from "./payables.mock";
import { loansMockApi } from "./loans.mock";
import { cashMockApi } from "./cash.mock";
import { accountingMockApi } from "./accounting.mock";
import { instrumentApi } from "./client";
import { resetDemoData } from "./mock-store";
import { authMockApi } from "./auth.mock";
import { authRealApi } from "./auth.real";
import type { AuthApi } from "./auth.api";

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
  recordPayment: async () => notImplemented(),
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
  void: async () => notImplemented(),
};

const payablesRealApi: PayablesApi = {
  listOutstanding: async () => notImplemented(),
  getSupplierBreakdown: async () => notImplemented(),
};

const loansRealApi: LoansApi = {
  list: async () => notImplemented(),
  getById: async () => notImplemented(),
  create: async () => notImplemented(),
  addCharge: async () => notImplemented(),
  recordRepayment: async () => notImplemented(),
};

const cashRealApi: CashApi = {
  list: async () => notImplemented(),
  latest: async () => notImplemented(),
  recordSnapshot: async () => notImplemented(),
};

const accountingRealApi: AccountingApi = {
  position: async () => notImplemented(),
  moneyFlow: async () => notImplemented(),
  listAccounts: async () => notImplemented(),
  createAccount: async () => notImplemented(),
  updateAccount: async () => notImplemented(),
  deactivateAccount: async () => notImplemented(),
  recordOpeningBalance: async () => notImplemented(),
  reconcileAccount: async () => notImplemented(),
  recordTransfer: async () => notImplemented(),
  recordManualEntry: async () => notImplemented(),
  listLedgerEntries: async () => notImplemented(),
  getMigrationNotice: async () => notImplemented(),
  dismissMigrationNotice: async () => notImplemented(),
};

const apiMode = process.env.NEXT_PUBLIC_API_MODE ?? "mock";

if (apiMode !== "mock" && apiMode !== "real") {
  throw new Error(`Unsupported NEXT_PUBLIC_API_MODE '${apiMode}'.`);
}

export const productsApi = instrumentApi(apiMode === "mock" ? productsMockApi : productsRealApi);
export const suppliersApi = instrumentApi(apiMode === "mock" ? suppliersMockApi : suppliersRealApi);
export const customersApi = instrumentApi(apiMode === "mock" ? customersMockApi : customersRealApi);
export const purchasesApi = instrumentApi(apiMode === "mock" ? purchasesMockApi : purchasesRealApi);
export const salesApi = instrumentApi(apiMode === "mock" ? salesMockApi : salesRealApi);
export const stockApi = instrumentApi(apiMode === "mock" ? stockMockApi : stockRealApi);
export const transfersApi = instrumentApi(apiMode === "mock" ? transfersMockApi : transfersRealApi);
export const adjustmentsApi = instrumentApi(apiMode === "mock" ? adjustmentsMockApi : adjustmentsRealApi);
export const reportsApi = instrumentApi(apiMode === "mock" ? reportsMockApi : reportsRealApi);
export const expensesApi = instrumentApi(apiMode === "mock" ? expensesMockApi : expensesRealApi);
export const payablesApi = instrumentApi(apiMode === "mock" ? payablesMockApi : payablesRealApi);
export const loansApi = instrumentApi(apiMode === "mock" ? loansMockApi : loansRealApi);
export const cashApi = instrumentApi(apiMode === "mock" ? cashMockApi : cashRealApi);
export const accountingApi = instrumentApi(apiMode === "mock" ? accountingMockApi : accountingRealApi);
export const authApi: AuthApi = apiMode === "mock" ? authMockApi : authRealApi;
export const isMockApiMode = apiMode === "mock";

export { resetDemoData };
export { AuthApiError } from "./auth.api";
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
export type { PayablesApi } from "./payables.api";
export type { LoansApi } from "./loans.api";
export type { CashApi } from "./cash.api";
export type { AccountingApi } from "./accounting.api";
export type { AuthApi, AuthUser } from "./auth.api";
