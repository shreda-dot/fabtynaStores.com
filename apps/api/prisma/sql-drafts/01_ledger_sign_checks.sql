-- =====================================================================
-- DRAFT — Ledger sign CHECK constraints
-- =====================================================================
-- These enforce the signed-amount convention declared in schema.prisma:
--   Customer ledger:  SALE +, PAYMENT -, RETURN -, CUSTOMER_REFUND -, ADJUSTMENT +/-
--   Supplier ledger:  PURCHASE +, PAYMENT -, ADJUSTMENT +/-
--   Account ledger:   money in +, money out -, ADJUSTMENT +/-
-- No amount may be zero.
--
-- This is a DRAFT. Do not run until the matching table exists and is empty
-- (or all existing rows already satisfy the constraint).

ALTER TABLE customer_ledger_entries
  ADD CONSTRAINT ck_customer_ledger_amount_sign
  CHECK (
    amount_kobo <> 0
    AND (
      (type = 'SALE'            AND amount_kobo > 0)
      OR (type = 'PAYMENT'       AND amount_kobo < 0)
      OR (type = 'RETURN'        AND amount_kobo < 0)
      OR (type = 'CUSTOMER_REFUND' AND amount_kobo < 0)
      OR (type = 'ADJUSTMENT'    AND amount_kobo <> 0)
    )
  );

ALTER TABLE supplier_ledger_entries
  ADD CONSTRAINT ck_supplier_ledger_amount_sign
  CHECK (
    amount_kobo <> 0
    AND (
      (type = 'PURCHASE'    AND amount_kobo > 0)
      OR (type = 'PAYMENT'   AND amount_kobo < 0)
      OR (type = 'ADJUSTMENT' AND amount_kobo <> 0)
    )
  );

ALTER TABLE account_ledger_entries
  ADD CONSTRAINT ck_account_ledger_amount_sign
  CHECK (
    amount_kobo <> 0
    AND (
      (type = 'SALE_PAYMENT'       AND amount_kobo > 0)
      OR (type = 'CUSTOMER_PAYMENT' AND amount_kobo > 0)
      OR (type = 'SUPPLIER_PAYMENT' AND amount_kobo < 0)
      OR (type = 'EXPENSE'          AND amount_kobo < 0)
      OR (type = 'CUSTOMER_REFUND'  AND amount_kobo < 0)
      OR (type = 'TRANSFER_IN'      AND amount_kobo > 0)
      OR (type = 'TRANSFER_OUT'     AND amount_kobo < 0)
      OR (type = 'OWNER_CAPITAL'    AND amount_kobo > 0)
      OR (type = 'OWNER_DRAWING'    AND amount_kobo < 0)
      OR (type = 'OTHER_INCOME'     AND amount_kobo > 0)
      OR (type = 'BANK_OR_POS_CHARGE' AND amount_kobo < 0)
      OR (type = 'ADJUSTMENT'       AND amount_kobo <> 0)
    )
  );
