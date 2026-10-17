-- =====================================================================
-- Ledger sign CHECK constraints
-- =====================================================================
-- Enforces the signed-amount convention declared in schema.prisma:
--   Customer ledger:  SALE +, PAYMENT -, RETURN -, CUSTOMER_REFUND -, ADJUSTMENT +/-
--   Supplier ledger:  PURCHASE +, PAYMENT -, ADJUSTMENT +/-
--   Account ledger:   money in +, money out -, ADJUSTMENT +/-
--   Loan ledger:      DISBURSEMENT +, CHARGE +, REPAYMENT -
-- No ledger amount may be zero.
--
-- Prisma maps only *table* names via @@map; column names stay camelCase and
-- are therefore written as quoted camelCase identifiers below.

ALTER TABLE customer_ledger_entries
  ADD CONSTRAINT ck_customer_ledger_amount_sign
  CHECK (
    "amountKobo" <> 0
    AND (
      (type = 'SALE'               AND "amountKobo" > 0)
      OR (type = 'PAYMENT'            AND "amountKobo" < 0)
      OR (type = 'RETURN'             AND "amountKobo" < 0)
      OR (type = 'CUSTOMER_REFUND'    AND "amountKobo" < 0)
      OR (type = 'ADJUSTMENT'         AND "amountKobo" <> 0)
    )
  );

ALTER TABLE supplier_ledger_entries
  ADD CONSTRAINT ck_supplier_ledger_amount_sign
  CHECK (
    "amountKobo" <> 0
    AND (
      (type = 'PURCHASE'    AND "amountKobo" > 0)
      OR (type = 'PAYMENT'     AND "amountKobo" < 0)
      OR (type = 'ADJUSTMENT'  AND "amountKobo" <> 0)
    )
  );

ALTER TABLE account_ledger_entries
  ADD CONSTRAINT ck_account_ledger_amount_sign
  CHECK (
    "amountKobo" <> 0
    AND (
      (type = 'SALE_PAYMENT'       AND "amountKobo" > 0)
      OR (type = 'CUSTOMER_PAYMENT'   AND "amountKobo" > 0)
      OR (type = 'SUPPLIER_PAYMENT'   AND "amountKobo" < 0)
      OR (type = 'EXPENSE'            AND "amountKobo" < 0)
      OR (type = 'CUSTOMER_REFUND'    AND "amountKobo" < 0)
      OR (type = 'TRANSFER_IN'        AND "amountKobo" > 0)
      OR (type = 'TRANSFER_OUT'       AND "amountKobo" < 0)
      OR (type = 'OWNER_CAPITAL'      AND "amountKobo" > 0)
      OR (type = 'OWNER_DRAWING'      AND "amountKobo" < 0)
      OR (type = 'OTHER_INCOME'       AND "amountKobo" > 0)
      OR (type = 'BANK_OR_POS_CHARGE' AND "amountKobo" < 0)
      OR (type = 'ADJUSTMENT'         AND "amountKobo" <> 0)
    )
  );

ALTER TABLE loan_ledger_entries
  ADD CONSTRAINT ck_loan_ledger_amount_sign
  CHECK (
    "amountKobo" <> 0
    AND (
      (type = 'DISBURSEMENT' AND "amountKobo" > 0)
      OR (type = 'CHARGE'       AND "amountKobo" > 0)
      OR (type = 'REPAYMENT'    AND "amountKobo" < 0)
    )
  );
