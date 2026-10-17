-- =====================================================================
-- Value sanity CHECK constraints
-- =====================================================================
-- Stops obviously invalid values (zero or negative quantities, negative
-- prices, zero-naira payments, transfers from a place to itself, business
-- dates that are not YYYY-MM-DD) even if application code has a bug.
--
-- Prisma maps only *table* names via @@map; column names stay camelCase and
-- are therefore written as quoted camelCase identifiers below.
--
-- Not enforced here on purpose:
--   * line total = unit cost x quantity (rounding can legitimately differ);
--   * "stock never below zero" (needs a transaction-level lock in the
--     service; see apps/api/src/modules/stock/stock.service.ts);
--   * paidKobo equals the sum of the matching payment rows. That is a
--     denormalisation the payment service owns; run the audit query at the
--     bottom of this file to detect drift.

-- ---------- products / customers ----------
ALTER TABLE products
  ADD CONSTRAINT ck_products_units_per_pack_positive CHECK ("unitsPerPack" > 0),
  ADD CONSTRAINT ck_products_money_nonnegative CHECK (
    "retailPriceKobo" >= 0 AND "wholesalePriceKobo" >= 0
    AND "averageCostKobo" >= 0
  ),
  ADD CONSTRAINT ck_products_reorder_nonnegative CHECK ("reorderLevelUnits" >= 0),
  ADD CONSTRAINT ck_products_sku_normalised
  CHECK (sku IS NULL OR sku = upper(btrim(sku)));

ALTER TABLE customers
  ADD CONSTRAINT ck_customers_credit_limit_nonnegative
  CHECK ("creditLimitKobo" >= 0);

-- ---------- purchases (supplier credit) ----------
ALTER TABLE purchases
  ADD CONSTRAINT ck_purchases_money_nonnegative CHECK (
    "totalKobo" >= 0 AND "paidKobo" >= 0
  ),
  ADD CONSTRAINT ck_purchases_paid_within_total
  CHECK ("paidKobo" <= "totalKobo"),
  ADD CONSTRAINT ck_purchases_due_date_format
  CHECK ("dueDate" IS NULL OR "dueDate" ~ '^\d{4}-\d{2}-\d{2}$');

ALTER TABLE purchase_lines
  ADD CONSTRAINT ck_purchase_lines_quantity_positive CHECK (
    quantity > 0 AND "unitsPerPackSnapshot" > 0 AND "quantityUnits" > 0
  ),
  ADD CONSTRAINT ck_purchase_lines_units_consistent CHECK (
    ("unit" = 'UNIT' AND "quantityUnits" = quantity)
    OR ("unit" = 'PACK' AND "quantityUnits" = quantity * "unitsPerPackSnapshot")
  ),
  ADD CONSTRAINT ck_purchase_lines_money_nonnegative CHECK (
    "unitCostKobo" >= 0 AND "lineTotalKobo" >= 0
  );

-- ---------- sales ----------
ALTER TABLE sales
  ADD CONSTRAINT ck_sales_money_nonnegative CHECK (
    "totalKobo" >= 0 AND "paidKobo" >= 0
  ),
  ADD CONSTRAINT ck_sales_paid_within_total CHECK ("paidKobo" <= "totalKobo"),
  ADD CONSTRAINT ck_sales_channel_not_both CHECK (channel <> 'BOTH');

ALTER TABLE sale_lines
  ADD CONSTRAINT ck_sale_lines_quantity_positive CHECK (
    quantity > 0 AND "unitsPerPackSnapshot" > 0 AND "quantityUnits" > 0
  ),
  ADD CONSTRAINT ck_sale_lines_units_consistent CHECK (
    ("unit" = 'UNIT' AND "quantityUnits" = quantity)
    OR ("unit" = 'PACK' AND "quantityUnits" = quantity * "unitsPerPackSnapshot")
  ),
  ADD CONSTRAINT ck_sale_lines_money_nonnegative CHECK (
    "unitPriceKobo" >= 0 AND "costPerUnitKobo" >= 0 AND "lineTotalKobo" >= 0
  );

-- ---------- stock transfers and adjustments ----------
ALTER TABLE stock_transfers
  ADD CONSTRAINT ck_stock_transfers_different_locations CHECK ("from" <> "to");

ALTER TABLE stock_transfer_lines
  ADD CONSTRAINT ck_stock_transfer_lines_quantity_positive
  CHECK ("quantityUnits" > 0);

ALTER TABLE stock_adjustment_lines
  ADD CONSTRAINT ck_stock_adjustment_lines_delta_nonzero
  CHECK ("quantityDeltaUnits" <> 0),
  ADD CONSTRAINT ck_stock_adjustment_lines_cost_nonnegative
  CHECK ("unitCostKobo" >= 0);

-- ---------- payments ----------
ALTER TABLE sale_payments
  ADD CONSTRAINT ck_sale_payments_amount_positive CHECK ("amountKobo" > 0);

ALTER TABLE supplier_payments
  ADD CONSTRAINT ck_supplier_payments_amount_positive CHECK ("amountKobo" > 0);

-- ---------- expenses ----------
ALTER TABLE expenses
  ADD CONSTRAINT ck_expenses_amount_positive CHECK ("amountKobo" > 0);

-- ---------- loans ----------
ALTER TABLE loans
  ADD CONSTRAINT ck_loans_principal_positive CHECK ("principalKobo" > 0),
  ADD CONSTRAINT ck_loans_interest_nonnegative CHECK ("agreedInterestKobo" >= 0),
  ADD CONSTRAINT ck_loans_due_date_format
  CHECK ("dueDate" IS NULL OR "dueDate" ~ '^\d{4}-\d{2}-\d{2}$');

ALTER TABLE loan_repayments
  ADD CONSTRAINT ck_loan_repayments_amount_positive CHECK ("amountKobo" > 0),
  ADD CONSTRAINT ck_loan_repayments_interest_nonnegative
  CHECK ("interestPortionKobo" >= 0),
  ADD CONSTRAINT ck_loan_repayments_interest_within_amount
  CHECK ("interestPortionKobo" <= "amountKobo");

-- ---------- cash snapshots ----------
ALTER TABLE cash_snapshots
  ADD CONSTRAINT ck_cash_snapshots_amount_nonnegative CHECK ("amountKobo" >= 0),
  ADD CONSTRAINT ck_cash_snapshots_as_of_date_format
  CHECK ("asOfDate" ~ '^\d{4}-\d{2}-\d{2}$');

-- =====================================================================
-- Drift audit (read-only; NOT a constraint)
-- =====================================================================
-- `paidKobo` is denormalised from the payment rows. Run these by hand (or in
-- the constraint test suite) to prove there is no drift. Both must return
-- zero rows on clean data.
--
-- SELECT p.id, p."paidKobo", COALESCE(SUM(sp."amountKobo"), 0) AS actual
--   FROM purchases p
--   LEFT JOIN supplier_payments sp ON sp."purchaseId" = p.id
--   GROUP BY p.id, p."paidKobo"
--   HAVING p."paidKobo" <> COALESCE(SUM(sp."amountKobo"), 0);
--
-- SELECT s.id, s."paidKobo", COALESCE(SUM(sp."amountKobo"), 0) AS actual
--   FROM sales s
--   LEFT JOIN sale_payments sp ON sp."saleId" = s.id
--   GROUP BY s.id, s."paidKobo"
--   HAVING s."paidKobo" <> COALESCE(SUM(sp."amountKobo"), 0);
