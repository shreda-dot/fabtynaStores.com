/** Display labels for money-flow category keys (entry types or EXPENSE:<category>). */
const FLOW_CATEGORY_LABELS: Record<string, string> = {
  SALE_PAYMENT: "Sale payments",
  CUSTOMER_PAYMENT: "Customer debt payments",
  SUPPLIER_PAYMENT: "Supplier payments",
  PURCHASE_PAYMENT: "Supplier-less purchases",
  EXPENSE: "Expenses",
  CUSTOMER_REFUND: "Customer refunds",
  TRANSFER_IN: "Transfers in",
  TRANSFER_OUT: "Transfers out",
  OWNER_CAPITAL: "Owner contributions",
  OWNER_DRAWING: "Owner withdrawals",
  OTHER_INCOME: "Other income",
  BANK_OR_POS_CHARGE: "Bank / POS charges",
  ADJUSTMENT: "Reconciliation adjustments",
  OPENING_BALANCE: "Opening balance",
  LOAN_DISBURSEMENT: "Loans received",
  LOAN_REPAYMENT: "Loan repayments (principal and interest)",
};

export function flowCategoryLabel(key: string): string {
  if (key.startsWith("EXPENSE:")) {
    const category = key.slice("EXPENSE:".length).toLocaleLowerCase();
    return `${category.charAt(0).toLocaleUpperCase()}${category.slice(1)} expenses`;
  }
  return FLOW_CATEGORY_LABELS[key] ?? key;
}
