-- =====================================================================
-- Voiding a sale that has on-account payments is blocked
-- =====================================================================
-- `voidSale` (packages/shared/src/domain/operations.ts) reverses the stock
-- movements and the customer ledger SALE entry, and nothing else. It does
-- not look at `sale_payments`, does not reverse the customer ledger PAYMENT
-- entries, and does not touch `paidKobo`. `voidPurchase` already refuses to
-- void when supplier payments exist; this migration gives the sale side the
-- same protection.
--
-- What the rule targets
-- ---------------------
-- A payment made UP FRONT at sale creation writes a `sale_payments` row but
-- NO customer ledger entry (the SALE entry already carries only the unpaid
-- portion). Voiding such a sale leaves the ledger at zero and is safe — a
-- same-day cash void is a legitimate correction.
--
-- A payment made LATER on account writes a customer ledger PAYMENT entry
-- (amount negative). Voiding the sale afterwards reverses only the SALE
-- entry, so the PAYMENT entry survives and the customer balance ends up
-- wrong. For a 10000 sale with a later 4000 payment, the ledger reads
-- +10000 - 4000 - 10000 = -4000 (a credit) instead of 0.
--
-- The predicate below therefore fires only when an actual PAYMENT ledger
-- entry exists for one of the sale's payments — i.e. exactly the case that
-- the current reversal mechanics cannot undo. The fix requires a refund
-- flow, which is a separate piece of work; until then the void is refused
-- with an actionable message, mirroring `voidPurchase`.
--
-- Prisma maps only *table* names via @@map; column names stay camelCase and
-- are therefore written as quoted camelCase identifiers below.

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
    ) THEN
      RAISE EXCEPTION
        'Sale % has on-account payments recorded and cannot be voided; reverse the payments instead of voiding the sale.',
        NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sale_void_guard
  BEFORE UPDATE OF status ON sales
  FOR EACH ROW EXECUTE FUNCTION fn_check_sale_void_guard();
