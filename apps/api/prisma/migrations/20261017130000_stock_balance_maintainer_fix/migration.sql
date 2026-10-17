-- =====================================================================
-- stock_balances: apply the movement by locking the row first
-- =====================================================================
-- The behavioural tests found a second, deeper defect in
-- `20261017100000_stock_balances`. The maintainer did:
--
--   INSERT INTO stock_balances (...) VALUES (NEW."quantityUnits")
--   ON CONFLICT ("productId", location)
--   DO UPDATE SET "quantityUnits" =
--     stock_balances."quantityUnits" + EXCLUDED."quantityUnits";
--
-- That idiom assumes the proposed tuple is allowed to exist on its own. It
-- is not. PostgreSQL evaluates CHECK constraints on the proposed tuple
-- BEFORE the unique-index arbitration, so for any movement whose quantity is
-- negative the statement died with
--
--   23514 new row for relation "stock_balances" violates check constraint
--   "ck_stock_balances_nonnegative"
--
-- *before* the arbiter could notice the row it was about to merge with.
-- Reproduced with a plain client-side upsert (no triggers involved) against
-- a row already holding 24: `VALUES (-10)` is rejected even though 24 + -10
-- is 14. That rejected every legal negative movement — stock adjustments and
-- the reversal rows of `20261017070000_reversal_sign_exemption` — and the
-- same CHECK also fired on the ordinary oversell case, so it looked correct
-- in the one situation the migration was written for.
--
-- The rewrite below UPDATEs first, so the arithmetic lands in the SET clause
-- and the CHECK sees the MERGED value, which is the value that actually has
-- to be non-negative. Only when no row exists does the movement create one,
-- and then the movement's quantity IS the balance.
--
-- Race safety is unchanged: the UPDATE takes the (productId, location) row
-- lock, and a second session's UPDATE blocks on it and then re-reads the
-- committed value before adding its own delta, so two sales cannot both
-- spend the same stock. The loser still fails with
-- `ck_stock_balances_nonnegative`.
--
-- The one new race is the very first movement for a (product, location):
-- two sessions can both miss the UPDATE and race to INSERT. The loser gets a
-- unique_violation, retries the UPDATE, and lands on the same arbitrated
-- arithmetic path instead of surfacing a duplicate-key error to the caller.
--
-- No object is renamed, so `expected-schema.ts` gains only this folder name.

CREATE OR REPLACE FUNCTION fn_apply_stock_movement() RETURNS trigger AS $$
DECLARE
  movement_units INTEGER := NEW."quantityUnits";
BEGIN
  LOOP
    UPDATE stock_balances
       SET "quantityUnits" = "quantityUnits" + movement_units,
           "updatedAt" = now()
     WHERE "productId" = NEW."productId" AND location = NEW.location;

    IF FOUND THEN
      RETURN NULL;
    END IF;

    BEGIN
      INSERT INTO stock_balances ("productId", location, "quantityUnits")
      VALUES (NEW."productId", NEW.location, movement_units);
      RETURN NULL;
    EXCEPTION WHEN unique_violation THEN
      -- Another session created this row in the gap between the UPDATE and
      -- the INSERT. Loop: the UPDATE finds the row now and the arithmetic
      -- happens under its lock.
      NULL;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
