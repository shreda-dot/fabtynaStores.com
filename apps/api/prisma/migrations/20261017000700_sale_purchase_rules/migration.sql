-- =====================================================================
-- Sale / purchase credit rules and the sale status lifecycle
-- =====================================================================
-- Prisma cannot express CHECK constraints or row-state transitions, so
-- these live here. Prisma maps only *table* names via @@map; column names
-- stay camelCase and are therefore double-quoted below.
--
-- 1. An UNPAID PURCHASE REQUIRES A SUPPLIER.
--    Mirrors createPurchase() in packages/shared/src/domain/operations.ts,
--    which throws "A supplier is required when a purchase is not fully
--    paid." A fully paid purchase (or a draft) needs no supplier on record.
--
-- 2. An UNPAID SALE REQUIRES A CUSTOMER ID.
--    Mirrors validateCompletedSalePayment() in
--    packages/shared/src/domain/ledger.ts, which throws
--    "A customer is required when a sale is not fully paid." and mirrors the
--    UI: sales/new refuses "a walk-in cannot owe money", and the retail-debtor
--    dialog requires a RETAIL customer.
--
--    `customerName` is deliberately NOT accepted as an alternative. The column
--    stays nullable and untouched, but the application never populates it
--    today (every create path sends null) — see docs/backend-schema.md.
--
-- 3. `VOIDED` IS TERMINAL FOR A SALE.
--    A voided sale may never leave `VOIDED`, and a `COMPLETED` sale may
--    never fall back to `DRAFT`. Only DRAFT -> COMPLETED, and any state ->
--    VOIDED, are legal. Enforced by a BEFORE UPDATE trigger because
--    Prisma has no notion of a status transition.

-- ---------------------------------------------------------------------
-- 1. Unpaid purchase requires a supplier
-- ---------------------------------------------------------------------
ALTER TABLE purchases
  ADD CONSTRAINT ck_purchases_unpaid_requires_supplier
  CHECK ("paidKobo" >= "totalKobo" OR "supplierId" IS NOT NULL);

-- ---------------------------------------------------------------------
-- 2. Unpaid sale requires a customer id
-- ---------------------------------------------------------------------
ALTER TABLE sales
  ADD CONSTRAINT ck_sales_unpaid_requires_customer
  CHECK ("paidKobo" >= "totalKobo" OR "customerId" IS NOT NULL);

-- ---------------------------------------------------------------------
-- 3. Sale status lifecycle: VOIDED is terminal, COMPLETED never -> DRAFT
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_check_sale_status_transition()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'VOIDED' AND NEW.status <> 'VOIDED' THEN
    RAISE EXCEPTION 'A VOIDED sale is terminal; cannot change status to %.', NEW.status;
  END IF;
  IF OLD.status = 'COMPLETED' AND NEW.status = 'DRAFT' THEN
    RAISE EXCEPTION 'A COMPLETED sale cannot return to DRAFT.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sales_status_transition
  BEFORE UPDATE OF status ON sales
  FOR EACH ROW EXECUTE FUNCTION fn_check_sale_status_transition();
