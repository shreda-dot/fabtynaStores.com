-- =====================================================================
-- Immutable-ledger triggers
-- =====================================================================
-- Ledger rows are append-only. A row can be "reversed" only by inserting a
-- new row whose reversesEntryId points at the original. UPDATE and DELETE on
-- every immutable table are rejected outright.
--
-- TRUNCATE bypasses row-level (FOR EACH ROW) triggers, so a statement-level
-- BEFORE TRUNCATE trigger guards each immutable table as well.
--
-- Additional invariants enforced here:
--   * A reversal must point at a row that is itself not a reversal
--     (reversal.reversesEntryId IS NULL).
--   * A TRANSFER stock movement's quantity sign must agree with its owning
--     StockTransferLeg.direction (OUT -> negative, IN -> positive). A CHECK
--     cannot read the related leg row, so a trigger enforces it.

CREATE OR REPLACE FUNCTION fn_raise_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is immutable; insert a reversal instead of %',
    TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

-- ---------- row-level UPDATE / DELETE guards ----------
CREATE TRIGGER trg_customer_ledger_immutable
  BEFORE UPDATE OR DELETE ON customer_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_supplier_ledger_immutable
  BEFORE UPDATE OR DELETE ON supplier_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_account_ledger_immutable
  BEFORE UPDATE OR DELETE ON account_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_stock_movement_immutable
  BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_loan_ledger_immutable
  BEFORE UPDATE OR DELETE ON loan_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_loan_repayment_immutable
  BEFORE UPDATE OR DELETE ON loan_repayments
  FOR EACH ROW EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_sale_payment_immutable
  BEFORE UPDATE OR DELETE ON sale_payments
  FOR EACH ROW EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_supplier_payment_immutable
  BEFORE UPDATE OR DELETE ON supplier_payments
  FOR EACH ROW EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_cash_snapshot_immutable
  BEFORE UPDATE OR DELETE ON cash_snapshots
  FOR EACH ROW EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION fn_raise_immutable();

-- ---------- statement-level TRUNCATE guards ----------
CREATE TRIGGER trg_customer_ledger_no_truncate
  BEFORE TRUNCATE ON customer_ledger_entries
  EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_supplier_ledger_no_truncate
  BEFORE TRUNCATE ON supplier_ledger_entries
  EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_account_ledger_no_truncate
  BEFORE TRUNCATE ON account_ledger_entries
  EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_stock_movement_no_truncate
  BEFORE TRUNCATE ON stock_movements
  EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_loan_ledger_no_truncate
  BEFORE TRUNCATE ON loan_ledger_entries
  EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_loan_repayment_no_truncate
  BEFORE TRUNCATE ON loan_repayments
  EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_sale_payment_no_truncate
  BEFORE TRUNCATE ON sale_payments
  EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_supplier_payment_no_truncate
  BEFORE TRUNCATE ON supplier_payments
  EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_cash_snapshot_no_truncate
  BEFORE TRUNCATE ON cash_snapshots
  EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_audit_log_no_truncate
  BEFORE TRUNCATE ON audit_logs
  EXECUTE FUNCTION fn_raise_immutable();

-- ---------- reversal chain integrity ----------
-- A reversal must point at a non-reversal row.
CREATE OR REPLACE FUNCTION fn_check_reversal_target()
RETURNS trigger AS $$
DECLARE
  target_reverses_id TEXT;
BEGIN
  IF NEW."reversesEntryId" IS NOT NULL THEN
    EXECUTE format(
      'SELECT "reversesEntryId" FROM %I WHERE id = $1',
      TG_TABLE_NAME
    ) INTO target_reverses_id USING NEW."reversesEntryId";

    IF target_reverses_id IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot reverse a reversal (id=%) on %.',
        NEW."reversesEntryId", TG_TABLE_NAME;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_customer_ledger_reversal_target
  BEFORE INSERT ON customer_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION fn_check_reversal_target();

CREATE TRIGGER trg_supplier_ledger_reversal_target
  BEFORE INSERT ON supplier_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION fn_check_reversal_target();

CREATE TRIGGER trg_account_ledger_reversal_target
  BEFORE INSERT ON account_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION fn_check_reversal_target();

CREATE TRIGGER trg_stock_movement_reversal_target
  BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION fn_check_reversal_target();

CREATE TRIGGER trg_loan_ledger_reversal_target
  BEFORE INSERT ON loan_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION fn_check_reversal_target();

-- ---------- transfer leg sign agreement ----------
CREATE OR REPLACE FUNCTION fn_check_transfer_leg_sign()
RETURNS trigger AS $$
DECLARE
  leg_direction TEXT;
BEGIN
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

CREATE TRIGGER trg_stock_movement_transfer_leg_sign
  BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION fn_check_transfer_leg_sign();
