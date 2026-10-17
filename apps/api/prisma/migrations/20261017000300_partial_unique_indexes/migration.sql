-- =====================================================================
-- Partial unique indexes (reversal chains, soft-deleted SKUs)
-- =====================================================================
-- A "live" ledger entry has reversesEntryId IS NULL. These partial unique
-- indexes guarantee that, per source document, at most one non-reversed
-- entry exists; reversal rows are exempt so a source can still be reversed
-- exactly once. The `*_reversed_once` indexes close the other half of the
-- rule: a given row can be the target of at most one reversal.

-- products: SKU uniqueness applies only to non-deleted rows
CREATE UNIQUE INDEX ux_products_sku_active
  ON products (sku)
  WHERE "deletedAt" IS NULL;

-- ---------- customer ledger: one non-reversed entry per source ----------
CREATE UNIQUE INDEX ux_customer_ledger_sale_active
  ON customer_ledger_entries ("saleId")
  WHERE "reversesEntryId" IS NULL AND "saleId" IS NOT NULL;

CREATE UNIQUE INDEX ux_customer_ledger_sale_payment_active
  ON customer_ledger_entries ("salePaymentId")
  WHERE "reversesEntryId" IS NULL AND "salePaymentId" IS NOT NULL;

CREATE UNIQUE INDEX ux_customer_ledger_customer_payment_active
  ON customer_ledger_entries ("customerPaymentId")
  WHERE "reversesEntryId" IS NULL AND "customerPaymentId" IS NOT NULL;

CREATE UNIQUE INDEX ux_customer_ledger_sale_return_active
  ON customer_ledger_entries ("saleReturnId")
  WHERE "reversesEntryId" IS NULL AND "saleReturnId" IS NOT NULL;

CREATE UNIQUE INDEX ux_customer_ledger_customer_refund_active
  ON customer_ledger_entries ("customerRefundId")
  WHERE "reversesEntryId" IS NULL AND "customerRefundId" IS NOT NULL;

-- ---------- supplier ledger: one non-reversed entry per source ----------
CREATE UNIQUE INDEX ux_supplier_ledger_purchase_active
  ON supplier_ledger_entries ("purchaseId")
  WHERE "reversesEntryId" IS NULL AND "purchaseId" IS NOT NULL;

CREATE UNIQUE INDEX ux_supplier_ledger_supplier_payment_active
  ON supplier_ledger_entries ("supplierPaymentId")
  WHERE "reversesEntryId" IS NULL AND "supplierPaymentId" IS NOT NULL;

-- ---------- account ledger: one non-reversed entry per source ----------
CREATE UNIQUE INDEX ux_account_ledger_sale_payment_active
  ON account_ledger_entries ("salePaymentId")
  WHERE "reversesEntryId" IS NULL AND "salePaymentId" IS NOT NULL;

CREATE UNIQUE INDEX ux_account_ledger_customer_payment_active
  ON account_ledger_entries ("customerPaymentId")
  WHERE "reversesEntryId" IS NULL AND "customerPaymentId" IS NOT NULL;

CREATE UNIQUE INDEX ux_account_ledger_supplier_payment_active
  ON account_ledger_entries ("supplierPaymentId")
  WHERE "reversesEntryId" IS NULL AND "supplierPaymentId" IS NOT NULL;

CREATE UNIQUE INDEX ux_account_ledger_expense_active
  ON account_ledger_entries ("expenseId")
  WHERE "reversesEntryId" IS NULL AND "expenseId" IS NOT NULL;

CREATE UNIQUE INDEX ux_account_ledger_other_income_active
  ON account_ledger_entries ("otherIncomeId")
  WHERE "reversesEntryId" IS NULL AND "otherIncomeId" IS NOT NULL;

CREATE UNIQUE INDEX ux_account_ledger_account_transfer_active
  ON account_ledger_entries ("accountTransferId")
  WHERE "reversesEntryId" IS NULL AND "accountTransferId" IS NOT NULL;

CREATE UNIQUE INDEX ux_account_ledger_customer_refund_active
  ON account_ledger_entries ("customerRefundId")
  WHERE "reversesEntryId" IS NULL AND "customerRefundId" IS NOT NULL;

-- ---------- loan ledger: one non-reversed entry per repayment source ----------
CREATE UNIQUE INDEX ux_loan_ledger_repayment_active
  ON loan_ledger_entries ("loanRepaymentId")
  WHERE "reversesEntryId" IS NULL AND "loanRepaymentId" IS NOT NULL;

-- ---------- stock movements: one non-reversed movement per source line ----------
CREATE UNIQUE INDEX ux_stock_movement_purchase_line_active
  ON stock_movements ("purchaseLineId")
  WHERE "reversesEntryId" IS NULL AND "purchaseLineId" IS NOT NULL;

CREATE UNIQUE INDEX ux_stock_movement_sale_line_active
  ON stock_movements ("saleLineId")
  WHERE "reversesEntryId" IS NULL AND "saleLineId" IS NOT NULL;

CREATE UNIQUE INDEX ux_stock_movement_transfer_leg_active
  ON stock_movements ("transferLegId")
  WHERE "reversesEntryId" IS NULL AND "transferLegId" IS NOT NULL;

CREATE UNIQUE INDEX ux_stock_movement_adjustment_line_active
  ON stock_movements ("adjustmentLineId")
  WHERE "reversesEntryId" IS NULL AND "adjustmentLineId" IS NOT NULL;

CREATE UNIQUE INDEX ux_stock_movement_return_line_active
  ON stock_movements ("returnLineId")
  WHERE "reversesEntryId" IS NULL AND "returnLineId" IS NOT NULL;

-- ---------- a given row can be reversed at most once ----------
CREATE UNIQUE INDEX ux_customer_ledger_reversed_once
  ON customer_ledger_entries ("reversesEntryId")
  WHERE "reversesEntryId" IS NOT NULL;

CREATE UNIQUE INDEX ux_supplier_ledger_reversed_once
  ON supplier_ledger_entries ("reversesEntryId")
  WHERE "reversesEntryId" IS NOT NULL;

CREATE UNIQUE INDEX ux_account_ledger_reversed_once
  ON account_ledger_entries ("reversesEntryId")
  WHERE "reversesEntryId" IS NOT NULL;

CREATE UNIQUE INDEX ux_loan_ledger_reversed_once
  ON loan_ledger_entries ("reversesEntryId")
  WHERE "reversesEntryId" IS NOT NULL;

CREATE UNIQUE INDEX ux_stock_movement_reversed_once
  ON stock_movements ("reversesEntryId")
  WHERE "reversesEntryId" IS NOT NULL;
