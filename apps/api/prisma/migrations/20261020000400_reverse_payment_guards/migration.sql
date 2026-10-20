-- =====================================================================
-- Reverse-payment support: void guards that ignore REVERSED payments
-- =====================================================================
-- A payment can now be reversed (a compensating row, never an edit). A payment
-- is LIVE until its reversal row exists, and only a LIVE payment blocks a void:
--
--   * sale:     a customer-ledger PAYMENT entry of one of the sale's payments
--               that has no row pointing at it through "reversesEntryId".
--   * purchase: a supplier payment whose SUPPLIER_PAYMENT account entry has no
--               reversal row (a payment paid at receipt counts too).
--
-- What is loosened: a document whose payments were all reversed can be voided.
-- Why it is safe: the reversal already wrote the compensating customer or
-- supplier row and the account row, so the void's own reversals leave every
-- ledger netting to zero exactly as for a document that never had a payment.
-- Prisma maps only table names; column names are quoted camelCase.

-- ---- 1. sale void guard: ignore a reversed on-account payment ----
CREATE OR REPLACE FUNCTION fn_check_sale_void_guard()
RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'VOIDED' AND OLD.status IS DISTINCT FROM 'VOIDED' THEN
    IF EXISTS (
      SELECT 1
        FROM sale_payments sp
        JOIN customer_ledger_entries cle
          ON cle."salePaymentId" = sp.id
       WHERE sp."saleId" = NEW.id
         AND cle.type = 'PAYMENT'
         AND cle."reversesEntryId" IS NULL
         AND NOT EXISTS (
           SELECT 1
             FROM customer_ledger_entries rev
            WHERE rev."reversesEntryId" = cle.id
         )
    ) THEN
      RAISE EXCEPTION
        'Sale % has on-account payments that have not been reversed and cannot be voided; reverse the payments first.',
        NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---- 2. purchase void guard (new): a live supplier payment blocks the void ----
CREATE OR REPLACE FUNCTION fn_check_purchase_void_guard()
RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'VOIDED' AND OLD.status IS DISTINCT FROM 'VOIDED' THEN
    IF EXISTS (
      SELECT 1
        FROM supplier_payments sp
       WHERE sp."purchaseId" = NEW.id
         AND NOT EXISTS (
           SELECT 1
             FROM account_ledger_entries rev
            WHERE rev."supplierPaymentId" = sp.id
              AND rev.type = 'SUPPLIER_PAYMENT'
              AND rev."reversesEntryId" IS NOT NULL
         )
    ) THEN
      RAISE EXCEPTION
        'Purchase % has supplier payments that have not been reversed and cannot be voided; reverse the payments first.',
        NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_purchase_void_guard
  BEFORE UPDATE OF status ON purchases
  FOR EACH ROW EXECUTE FUNCTION fn_check_purchase_void_guard();

-- ---- 3. account-ledger reversals may carry their own reason ----
-- The generic reversal-integrity trigger required a reversal to match its
-- target on every column except id and timestamps, "note" included. A payment
-- reversal stores the owner's REASON in the account entry's note, so the note
-- of an ACCOUNT ledger reversal is now exempt. Amount negation, type, account
-- and every source column are still enforced; the other tables are unchanged.
CREATE OR REPLACE FUNCTION fn_check_reversal_integrity()
RETURNS trigger AS $$
DECLARE
  target_json JSONB;
  magnitude_column TEXT;
  magnitude_value BIGINT;
  excluded_columns TEXT[] := ARRAY['id', 'occurredAt', 'createdAt', 'reversesEntryId'];
BEGIN
  IF NEW."reversesEntryId" IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'account_ledger_entries' THEN
    excluded_columns := excluded_columns || ARRAY['note'];
  END IF;

  magnitude_column :=
    CASE TG_TABLE_NAME
      WHEN 'stock_movements' THEN 'quantityUnits'
      ELSE 'amountKobo'
    END;

  EXECUTE format('SELECT to_jsonb(t) FROM %I t WHERE id = $1', TG_TABLE_NAME)
    INTO target_json
    USING NEW."reversesEntryId";

  IF target_json IS NULL THEN
    RAISE EXCEPTION 'Reversal target % not found on %.',
      NEW."reversesEntryId", TG_TABLE_NAME;
  END IF;

  magnitude_value := (target_json ->> magnitude_column)::bigint;

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
