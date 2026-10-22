import { describe, expect, it } from "vitest";
import { queryKeys } from "./query-keys";

describe("query key shape separation", () => {
  it("keeps list, infinite pages, and detail keys distinct", () => {
    const shapedKeys = [
      queryKeys.products.list("lager", false),
      queryKeys.products.pages("lager", false),
      queryKeys.products.detail("product-1"),
      queryKeys.customers.list("", false),
      queryKeys.customers.pages("", false),
      queryKeys.customers.detail("customer-1"),
      queryKeys.suppliers.list("", false),
      queryKeys.suppliers.pages("", false),
      queryKeys.suppliers.detail("supplier-1"),
      queryKeys.sales.list,
      queryKeys.sales.page({ from: "2026-10-21" }),
      queryKeys.sales.detail("sale-1"),
      queryKeys.purchases.list,
      queryKeys.purchases.page({ from: "2026-10-21" }),
      queryKeys.purchases.detail("purchase-1"),
      queryKeys.expenses.list("2026-10-21", "2026-10-21"),
      queryKeys.expenses.detail("expense-1"),
      queryKeys.transfers.list,
      queryKeys.transfers.detail("transfer-1"),
      queryKeys.adjustments.list,
      queryKeys.adjustments.detail("adjustment-1"),
      queryKeys.loans.list,
      queryKeys.loans.pages({ status: "ACTIVE" }),
      queryKeys.loans.detail("loan-1"),
      queryKeys.accounting.accounts,
      queryKeys.accounting.accountLedger("account-1"),
    ];
    const serialized = shapedKeys.map((key) => JSON.stringify(key));
    expect(new Set(serialized).size).toBe(serialized.length);
  });
});
