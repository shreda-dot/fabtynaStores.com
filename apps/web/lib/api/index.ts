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
import { createNotConnectedError, instrumentApi, requestJson } from "./client";
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
import type { TransfersApi } from "./transfers.api";
import type { AdjustmentsApi } from "./adjustments.api";
import type { ReportsApi } from "./reports.api";
import type { ExpensesApi } from "./expenses.api";
import type { PayablesApi } from "./payables.api";
import type { LoansApi } from "./loans.api";
import type { CashApi } from "./cash.api";

function notImplemented(): never {
  throw createNotConnectedError();
}

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
  listPaymentAccounts: async () =>
    requestJson<Awaited<ReturnType<AccountingApi["listPaymentAccounts"]>>>(
      "/accounts?includeInactive=false",
    ),
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
export const accountingApi = apiMode === "mock" ? instrumentApi(accountingMockApi) : accountingRealApi;
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
