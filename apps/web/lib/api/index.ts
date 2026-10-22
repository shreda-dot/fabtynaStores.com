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
import { accountingRealApi } from "./accounting.real";
import { expensesRealApi } from "./expenses.real";
import { loansRealApi } from "./loans.real";
import { transfersRealApi } from "./transfers.real";
import { adjustmentsRealApi } from "./adjustments.real";
import { createNotConnectedError, instrumentApi } from "./client";
import { resetDemoData } from "./mock-store";
import { authMockApi } from "./auth.mock";
import { authRealApi } from "./auth.real";
import type { AuthApi } from "./auth.api";
import { productsRealApi } from "./products.real";
import { suppliersRealApi } from "./suppliers.real";
import { customersRealApi } from "./customers.real";
import { stockRealApi } from "./stock.real";
import { payablesRealApi } from "./payables.real";
import { salesRealApi } from "./sales.real";
import { purchasesRealApi } from "./purchases.real";
import { debtorsMockApi } from "./debtors.mock";
import { debtorsRealApi } from "./debtors.real";
import type { DebtorsApi } from "./debtors.api";
import type { ReportsApi } from "./reports.api";
import type { CashApi } from "./cash.api";
import type { AccountingApi } from "./accounting.api";

function notImplemented(): never {
  throw createNotConnectedError();
}

const reportsRealApi: ReportsApi = {
  salesSummary: async () => notImplemented(),
};

const cashRealApi: CashApi = {
  list: async () => notImplemented(),
  latest: async () => notImplemented(),
  recordSnapshot: async () => notImplemented(),
};

const accountingReal7CApi: AccountingApi = {
  ...accountingRealApi,
  position: async () => notImplemented(),
  moneyFlow: async () => notImplemented(),
};

const apiMode = process.env.NEXT_PUBLIC_API_MODE ?? "mock";

if (apiMode !== "mock" && apiMode !== "real") {
  throw new Error(`Unsupported NEXT_PUBLIC_API_MODE '${apiMode}'.`);
}

export const productsApi = apiMode === "mock" ? instrumentApi(productsMockApi) : productsRealApi;
export const suppliersApi = apiMode === "mock" ? instrumentApi(suppliersMockApi) : suppliersRealApi;
export const customersApi = apiMode === "mock" ? instrumentApi(customersMockApi) : customersRealApi;
export const purchasesApi = apiMode === "mock" ? instrumentApi(purchasesMockApi) : purchasesRealApi;
export const salesApi = apiMode === "mock" ? instrumentApi(salesMockApi) : salesRealApi;
export const stockApi = apiMode === "mock" ? instrumentApi(stockMockApi) : stockRealApi;
export const transfersApi = apiMode === "mock" ? instrumentApi(transfersMockApi) : transfersRealApi;
export const adjustmentsApi = apiMode === "mock" ? instrumentApi(adjustmentsMockApi) : adjustmentsRealApi;
export const reportsApi = apiMode === "mock" ? instrumentApi(reportsMockApi) : reportsRealApi;
export const expensesApi = apiMode === "mock" ? instrumentApi(expensesMockApi) : expensesRealApi;
export const payablesApi = apiMode === "mock" ? instrumentApi(payablesMockApi) : payablesRealApi;
export const debtorsApi: DebtorsApi = apiMode === "mock" ? instrumentApi(debtorsMockApi) : debtorsRealApi;
export const loansApi = apiMode === "mock" ? instrumentApi(loansMockApi) : loansRealApi;
export const cashApi = apiMode === "mock" ? instrumentApi(cashMockApi) : cashRealApi;
export const accountingApi = apiMode === "mock" ? instrumentApi(accountingMockApi) : accountingReal7CApi;
export const authApi: AuthApi = apiMode === "mock" ? authMockApi : authRealApi;
export const isMockApiMode = apiMode === "mock";

export { resetDemoData };
export { AuthApiError } from "./auth.api";
export type { DebtorsApi } from "./debtors.api";
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
