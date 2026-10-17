-- =====================================================================
-- Document locks: sale/purchase headers and every line table
-- =====================================================================
-- Two rules, matching what the application actually does today.
--
-- A. Header updates are an ALLOWLIST.
--    Once a sale or purchase has left DRAFT (or was created directly in a
--    completed state, which is what `recordSale` / `receivePurchase` do),
--    the only columns the code ever changes in place are:
--        paidKobo   -- recordSalePayment / recordPurchasePayment
--        status     -- voidSale / voidPurchase (-> VOIDED only)
--        updatedAt  -- alongside both of the above
--    Amendment does NOT edit the original: sales.update / purchases.update
--    void the original and create a replacement document. So nothing else
--    may change, and an allowlist (rather than a list of forbidden columns)
--    means a column added later is locked by default.
--
--    The check is expressed as a jsonb comparison of the two row images with
--    the allowed keys removed, so it needs no maintenance as columns are
--    added.
--
-- B. Line rows are immutable, and a non-draft document cannot be deleted.
--    Editing a line after the document is complete would silently change
--    totals, stock and cost that are already recorded. Deleting the header
--    would strand its lines, movements and ledger entries, so it is refused
--    too -- void it instead.
--
-- Status legality itself (VOIDED is terminal for a sale) stays in
-- `20261017000700_sale_purchase_rules`, and this migration does not duplicate
-- it.
--
-- Prisma maps only *table* names via @@map; column names stay camelCase and
-- are therefore written as quoted camelCase identifiers below.

-- =====================================================================
-- A. Header allowlist (sales, purchases)
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_check_document_lock()
RETURNS trigger AS $$
DECLARE
  allowed_columns TEXT[] := ARRAY['paidKobo', 'status', 'updatedAt'];
  draft_status TEXT := CASE TG_TABLE_NAME WHEN 'sales' THEN 'DRAFT' ELSE 'DRAFT' END;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IS DISTINCT FROM draft_status THEN
      RAISE EXCEPTION
        'A % that is not a DRAFT cannot be deleted; void it instead (id=%).',
        TG_TABLE_NAME, OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  -- A draft is still fully editable; the lock applies once it is complete.
  IF OLD.status IS DISTINCT FROM draft_status THEN
    IF (to_jsonb(NEW) - allowed_columns) IS DISTINCT FROM
       (to_jsonb(OLD) - allowed_columns) THEN
      RAISE EXCEPTION
        'A completed % may only change paidKobo, status and updatedAt; another column was modified (id=%).',
        TG_TABLE_NAME, OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sale_document_lock
  BEFORE UPDATE OR DELETE ON sales
  FOR EACH ROW EXECUTE FUNCTION fn_check_document_lock();

CREATE TRIGGER trg_purchase_document_lock
  BEFORE UPDATE OR DELETE ON purchases
  FOR EACH ROW EXECUTE FUNCTION fn_check_document_lock();

-- =====================================================================
-- B. Line tables are immutable
-- =====================================================================
CREATE TRIGGER trg_sale_line_immutable
  BEFORE UPDATE OR DELETE ON sale_lines
  FOR EACH ROW EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_purchase_line_immutable
  BEFORE UPDATE OR DELETE ON purchase_lines
  FOR EACH ROW EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_stock_transfer_line_immutable
  BEFORE UPDATE OR DELETE ON stock_transfer_lines
  FOR EACH ROW EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_stock_transfer_leg_immutable
  BEFORE UPDATE OR DELETE ON stock_transfer_legs
  FOR EACH ROW EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_stock_adjustment_line_immutable
  BEFORE UPDATE OR DELETE ON stock_adjustment_lines
  FOR EACH ROW EXECUTE FUNCTION fn_raise_immutable();

-- TRUNCATE bypasses row-level triggers.
CREATE TRIGGER trg_sale_line_no_truncate
  BEFORE TRUNCATE ON sale_lines
  EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_purchase_line_no_truncate
  BEFORE TRUNCATE ON purchase_lines
  EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_stock_transfer_line_no_truncate
  BEFORE TRUNCATE ON stock_transfer_lines
  EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_stock_transfer_leg_no_truncate
  BEFORE TRUNCATE ON stock_transfer_legs
  EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_stock_adjustment_line_no_truncate
  BEFORE TRUNCATE ON stock_adjustment_lines
  EXECUTE FUNCTION fn_raise_immutable();
