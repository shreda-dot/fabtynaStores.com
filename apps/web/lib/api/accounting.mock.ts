import {
  computeFinancialPosition,
  getLagosBusinessDate,
  loanOutstandingKobo,
  purchaseBalanceKobo,
  stockByProductAndLocation,
  type FinancialObligation,
  type FinancialPositionProductInput,
} from "@fabtyna/shared";
import type { AccountingApi } from "./accounting.api";
import { readMockStore } from "./mock-store";
import { mockDelay } from "./mock-transport";

function delay(): Promise<void> {
  return mockDelay();
}

export const accountingMockApi: AccountingApi = {
  async position(options) {
    await delay();
    const store = readMockStore();
    const today = getLagosBusinessDate();

    const byProductLocation = stockByProductAndLocation(store.stockMovements);

    // Include inactive products that still hold stock; ignore zero/negative
    // quantities (the domain also guards this, but we avoid the noise here).
    const products: FinancialPositionProductInput[] = [];
    for (const product of store.products) {
      const byLocation = byProductLocation.get(product.id) ?? new Map();
      const warehouseUnits = byLocation.get("WAREHOUSE") ?? 0;
      const fridgeUnits =
        (byLocation.get("RETAIL_SHELF") ?? 0) + (byLocation.get("MARKET") ?? 0);
      if (warehouseUnits <= 0 && fridgeUnits <= 0) continue;

      const packSize = product.unitsPerPack > 0 ? product.unitsPerPack : 1;
      const warehousePacks = Math.floor(warehouseUnits / packSize);
      const warehouseLooseUnits = warehouseUnits - warehousePacks * packSize;

      products.push({
        productId: product.id,
        productName: product.name,
        warehousePacks,
        warehouseLooseUnits,
        fridgeUnits,
        packSizeUnits: packSize,
        retailPriceKobo: product.retailPriceKobo,
        wholesalePriceKobo: product.wholesalePriceKobo,
        averageCostKobo: product.averageCostKobo,
      });
    }

    // Receivables: every non-voided sale that still owes money, all dates.
    let receivablesKobo = 0n;
    for (const sale of store.sales) {
      if (sale.status === "VOIDED") continue;
      const owed = sale.totalKobo - sale.paidKobo;
      if (owed > 0n) receivablesKobo += owed;
    }

    // Cash: the latest manual snapshot (0 when none exists).
    let cashKobo = 0n;
    let latestDate = "";
    let latestCreated = -1;
    for (const snapshot of store.cashSnapshots) {
      const created = snapshot.createdAt.getTime();
      if (
        snapshot.asOfDate > latestDate ||
        (snapshot.asOfDate === latestDate && created >= latestCreated)
      ) {
        latestDate = snapshot.asOfDate;
        latestCreated = created;
        cashKobo = snapshot.amountKobo;
      }
    }

    // Supplier payables, with a per-supplier breakdown for the position page.
    const payablesBySupplierMap = new Map<string, bigint>();
    const obligations: Omit<FinancialObligation, "urgency">[] = [];
    let supplierPayablesKobo = 0n;
    for (const purchase of store.purchases) {
      if (purchase.status === "VOIDED" || purchase.supplierId === null) continue;
      const balance = purchaseBalanceKobo(purchase);
      if (balance <= 0n) continue;
      supplierPayablesKobo += balance;
      payablesBySupplierMap.set(
        purchase.supplierId,
        (payablesBySupplierMap.get(purchase.supplierId) ?? 0n) + balance,
      );
      const supplier = store.suppliers.find((s) => s.id === purchase.supplierId);
      obligations.push({
        kind: "SUPPLIER_PURCHASE",
        id: purchase.id,
        label: `${supplier?.name ?? "Supplier"} — ${purchase.reference ?? purchase.id.slice(0, 8)}`,
        balanceKobo: balance,
        dueDate: purchase.dueDate,
      });
    }

    const payablesBySupplier = Array.from(payablesBySupplierMap.entries()).map(
      ([supplierId, amountKobo]) => ({
        supplierId,
        supplierName:
          store.suppliers.find((s) => s.id === supplierId)?.name ?? "Unknown supplier",
        amountKobo,
      }),
    );

    // Loans, with a per-lender breakdown and per-loan obligations.
    const loansByLender: { loanId: string; lenderName: string; amountKobo: bigint }[] = [];
    let loansOutstandingKobo = 0n;
    for (const loan of store.loans) {
      const outstanding = loanOutstandingKobo(loan.id, store.loanLedgerEntries);
      if (outstanding <= 0n) continue;
      loansOutstandingKobo += outstanding;
      loansByLender.push({
        loanId: loan.id,
        lenderName: loan.lenderName,
        amountKobo: outstanding,
      });
      obligations.push({
        kind: "LOAN",
        id: loan.id,
        label: `${loan.lenderName} loan`,
        balanceKobo: outstanding,
        dueDate: loan.dueDate,
      });
    }

    const result = computeFinancialPosition({
      todayLagosDate: today,
      products,
      receivablesKobo,
      cashKobo,
      supplierPayablesKobo,
      loansOutstandingKobo,
      options,
      liabilitiesBreakdown: { payablesBySupplier, loansByLender },
      obligations,
    });

    return result;
  },
};
