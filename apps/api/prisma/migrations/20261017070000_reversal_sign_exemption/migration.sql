-- =====================================================================
-- Reversal rows are exempt from the sign CHECKs
-- =====================================================================
-- A reversal row copies its target and negates ONLY the magnitude column
-- (`amountKobo` for ledgers, `quantityUnits` for stock movements), keeping
-- the target's `type` and every source/document column. The sign CHECKs
-- added in `20261017000100_ledger_sign_checks` and
-- `20261017000200_stock_movement_checks` were written without that case in
-- mind, so they rejected every legal reversal: e.g. reversing a `SALE`
-- ledger entry (amount +1000) needs a `SALE` row with amount -1000, which
-- the SALE-must-be-positive rule refused.
--
-- The domain already exempts reversal rows from the sign rule
-- (packages/shared/src/domain/invariants.ts, `validateMovementSignAndSource`
-- only checks the sign when `reversesEntryId === null`). This migration
-- makes the database agree with the domain.
--
-- Exempting a row from the sign rule alone would be unsafe, so the exemption
-- is paired with a new integrity trigger (`fn_check_reversal_integrity`,
-- section C below) that proves the reversal really is the negation of its
-- target: same type, negated magnitude, and identical product / location /
-- customer / supplier / account / loan / document-source columns.
--
-- Prisma maps only *table* names via @@map; column names stay camelCase and
-- are therefore written as quoted camelCase identifiers below.

-- =====================================================================
-- A. Ledger sign CHECKs: add the reversal exemption
-- =====================================================================
-- DROP + ADD keeps the original constraint NAMES, so `expected-schema.ts`
-- and every existing FAIL-on-rename guarantee stay valid.

ALTER TABLE customer_ledger_entries
  DROP CONSTRAINT ck_customer_ledger_amount_sign;
ALTER TABLE customer_ledger_entries
  ADD CONSTRAINT ck_customer_ledger_amount_sign
  CHECK (
    "reversesEntryId" IS NOT NULL
    OR (
      "amountKobo" <> 0
      AND (
        (type = 'SALE'               AND "amountKobo" > 0)
        OR (type = 'PAYMENT'            AND "amountKobo" < 0)
        OR (type = 'RETURN'             AND "amountKobo" < 0)
        OR (type = 'CUSTOMER_REFUND'    AND "amountKobo" < 0)
        OR (type = 'ADJUSTMENT'         AND "amountKobo" <> 0)
      )
    )
  );

ALTER TABLE supplier_ledger_entries
  DROP CONSTRAINT ck_supplier_ledger_amount_sign;
ALTER TABLE supplier_ledger_entries
  ADD CONSTRAINT ck_supplier_ledger_amount_sign
  CHECK (
    "reversesEntryId" IS NOT NULL
    OR (
      "amountKobo" <> 0
      AND (
        (type = 'PURCHASE'    AND "amountKobo" > 0)
        OR (type = 'PAYMENT'     AND "amountKobo" < 0)
        OR (type = 'ADJUSTMENT'  AND "amountKobo" <> 0)
      )
    )
  );

ALTER TABLE account_ledger_entries
  DROP CONSTRAINT ck_account_ledger_amount_sign;
ALTER TABLE account_ledger_entries
  ADD CONSTRAINT ck_account_ledger_amount_sign
  CHECK (
    "reversesEntryId" IS NOT NULL
    OR (
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
    )
  );

ALTER TABLE loan_ledger_entries
  DROP CONSTRAINT ck_loan_ledger_amount_sign;
ALTER TABLE loan_ledger_entries
  ADD CONSTRAINT ck_loan_ledger_amount_sign
  CHECK (
    "reversesEntryId" IS NOT NULL
    OR (
      "amountKobo" <> 0
      AND (
        (type = 'DISBURSEMENT' AND "amountKobo" > 0)
        OR (type = 'CHARGE'       AND "amountKobo" > 0)
        OR (type = 'REPAYMENT'    AND "amountKobo" < 0)
      )
    )
  );

-- =====================================================================
-- B. Stock movement sign CHECK: add the reversal exemption
-- =====================================================================
ALTER TABLE stock_movements
  DROP CONSTRAINT ck_stock_movement_quantity_sign;
ALTER TABLE stock_movements
  ADD CONSTRAINT ck_stock_movement_quantity_sign
  CHECK (
    "reversesEntryId" IS NOT NULL
    OR (type = 'PURCHASE'      AND "quantityUnits" > 0)
    OR (type = 'SALE'          AND "quantityUnits" < 0)
    OR (type = 'RETURN'        AND "quantityUnits" > 0)
    OR (type = 'ADJUSTMENT'    AND "quantityUnits" <> 0)
    OR (type = 'TRANSFER'      AND "quantityUnits" <> 0)
  );

-- =====================================================================
-- C. Reversal integrity trigger
-- =====================================================================
-- The exemption above is only safe if something else proves the reversal is
-- the exact negation of a real target. One generic function serves all five
-- tables: it compares the new row against its target after removing the
-- columns that are allowed to differ (the row identity, the timestamps and
-- the pointer itself), and requires the magnitude column to be the exact
-- negation.
--
-- The jsonb comparison is deliberate: it enforces, in a single predicate,
-- that `type`, the owning customer / supplier / account / loan, `productId`
-- and `location`, and EVERY source column (saleId, salePaymentId,
-- customerPaymentId, purchaseId, supplierPaymentId, expenseId, ...,
-- purchaseLineId, saleLineId, transferLegId, adjustmentLineId, returnLineId)
-- all match, so a new source column is covered automatically.
--
-- `occurredAt` (ledgers, stock movements) and `createdAt` (stock movements)
-- are excluded because a reversal is a new event at a new time. `note` is
-- deliberately NOT excluded: buildLedgerReversal copies it, and forcing it
-- to match keeps the two chained copies identical.
CREATE OR REPLACE FUNCTION fn_check_reversal_integrity()
RETURNS trigger AS $$
DECLARE
  target_row RECORD;
  target_json JSONB;
  magnitude_column TEXT;
  magnitude_value BIGINT;
  excluded_columns TEXT[] := ARRAY['id', 'occurredAt', 'createdAt', 'reversesEntryId'];
BEGIN
  IF NEW."reversesEntryId" IS NULL THEN
    RETURN NEW;
  END IF;

  magnitude_column :=
    CASE TG_TABLE_NAME
      WHEN 'stock_movements' THEN 'quantityUnits'
      ELSE 'amountKobo'
    END;

  EXECUTE format('SELECT * FROM %I WHERE id = $1', TG_TABLE_NAME)
    INTO target_row
    USING NEW."reversesEntryId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reversal target % not found on %.',
      NEW."reversesEntryId", TG_TABLE_NAME;
  END IF;

  target_json := to_jsonb(target_row);
  magnitude_value := ((target_json -> magnitude_column)::text)::bigint;

  IF (to_jsonb(NEW) - excluded_columns) IS DISTINCT FROM (
    (target_json - excluded_columns)
    || jsonb_build_object(magnitude_column, -magnitude_value)
  ) THEN
    RAISE EXCEPTION
      'A reversal must negate % and match its target on type and every source column (%).',
      magnitude_column, TG_TABLE_NAME;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_customer_ledger_reversal_integrity
  BEFORE INSERT ON customer_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION fn_check_reversal_integrity();

CREATE TRIGGER trg_supplier_ledger_reversal_integrity
  BEFORE INSERT ON supplier_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION fn_check_reversal_integrity();

CREATE TRIGGER trg_account_ledger_reversal_integrity
  BEFORE INSERT ON account_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION fn_check_reversal_integrity();

CREATE TRIGGER trg_stock_movement_reversal_integrity
  BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION fn_check_reversal_integrity();

CREATE TRIGGER trg_loan_ledger_reversal_integrity
  BEFORE INSERT ON loan_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION fn_check_reversal_integrity();

-- =====================================================================
-- D. Transfer-leg sign agreement: exempt reversal rows
-- =====================================================================
-- `fn_check_transfer_leg_sign` demanded that an OUT leg be negative and an
-- IN leg positive. A reversal of a transfer movement has the opposite sign
-- by definition, so it must be exempt — `fn_check_reversal_integrity` now
-- proves the reversal's quantity is the negation of the original leg
-- movement, which is the stronger claim.
CREATE OR REPLACE FUNCTION fn_check_transfer_leg_sign()
RETURNS trigger AS $$
DECLARE
  leg_direction TEXT;
BEGIN
  IF NEW."reversesEntryId" IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.type = 'TRANSFER' AND NEW."transferLegId" IS NOT NULL THEN
    SELECT direction INTO leg_direction
      FROM stock_transfer_legs
      WHERE id = NEW."transferLegId";

    IF leg_direction = 'OUT' AND NEW."quantityUnits" >= 0 THEN
      RAISE EXCEPTION 'An OUT transfer leg must have a negative quantity.';
    END IF;
    IF leg_direction = 'IN' AND NEW."quantityUnits" <= 0 THEN
      RAISE EXCEPTION 'An IN transfer leg must have a positive quantity.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
