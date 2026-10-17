-- =====================================================================
-- stock_balances: the "stock never goes below zero" guard
-- =====================================================================
-- Until now "stock never below zero" lived only in application code
-- (packages/shared `assertStockWillRemainNonnegative`, checked against a
-- snapshot of `stock_movements` the caller happened to hold). Two concurrent
-- sales can both see the last unit as available and both write. This
-- migration makes the database the arbiter.
--
-- Shape
-- -----
-- `stock_balances` is a DERIVED, one-row-per-(product, location) cache of
-- `SUM(stock_movements.quantityUnits)`. It is maintained exclusively by an
-- AFTER INSERT trigger on `stock_movements`; nothing else may write it.
--
-- Why this is race-safe
-- ---------------------
-- The trigger does a single `INSERT ... ON CONFLICT DO UPDATE`, which takes a
-- row lock on the balance. The arithmetic and the `quantityUnits >= 0` CHECK
-- are evaluated inside that same statement, under that lock, so a second
-- concurrent transaction cannot interleave between "read the balance" and
-- "write the balance". The loser of the race fails the CHECK instead of
-- overselling. `stock_movements` is append-only (its UPDATE/DELETE are already
-- rejected), so the only way the balance can change is a new movement, which
-- always routes through this trigger.
--
-- Order matters: the table is created and back-filled BEFORE the triggers are
-- installed, because the back-fill INSERT would otherwise be rejected by the
-- direct-write guard below.
--
-- Prisma maps only *table* names via @@map; column names stay camelCase and
-- are therefore written as quoted camelCase identifiers below.

CREATE TABLE stock_balances (
    "productId" TEXT NOT NULL,
    location "StockLocation" NOT NULL,
    "quantityUnits" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT stock_balances_pkey PRIMARY KEY ("productId", location),
    CONSTRAINT fk_stock_balances_product
      FOREIGN KEY ("productId") REFERENCES products (id) ON DELETE RESTRICT,
    CONSTRAINT ck_stock_balances_nonnegative CHECK ("quantityUnits" >= 0)
);

-- Back-fill from the append-only movement log (a single pass; the log is small
-- and already the source of truth).
INSERT INTO stock_balances ("productId", location, "quantityUnits")
SELECT "productId", location, SUM("quantityUnits")::integer
  FROM stock_movements
 GROUP BY "productId", location;

-- ---------------------------------------------------------------------
-- Maintainer: the ONLY writer of stock_balances
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_apply_stock_movement()
RETURNS trigger AS $$
BEGIN
  INSERT INTO stock_balances ("productId", location, "quantityUnits", "updatedAt")
  VALUES (NEW."productId", NEW.location, NEW."quantityUnits", now())
  ON CONFLICT ("productId", location)
  DO UPDATE
    SET "quantityUnits" = stock_balances."quantityUnits" + EXCLUDED."quantityUnits",
        "updatedAt" = now();

  RETURN NULL;  -- AFTER trigger; the return value is ignored
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stock_movement_apply
  AFTER INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION fn_apply_stock_movement();

-- ---------------------------------------------------------------------
-- Guard: reject any write that does not come from the trigger above
-- ---------------------------------------------------------------------
-- pg_trigger_depth() is 0 only for a statement issued directly by a client.
-- An INSERT from `fn_apply_stock_movement` runs at depth >= 1, so it passes.
CREATE OR REPLACE FUNCTION fn_stock_balance_direct_write_guard()
RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() = 0 THEN
    RAISE EXCEPTION
      'stock_balances is derived from stock_movements and must not be written directly (attempted %).',
      TG_OP;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stock_balances_guard
  BEFORE INSERT OR UPDATE OR DELETE ON stock_balances
  FOR EACH ROW EXECUTE FUNCTION fn_stock_balance_direct_write_guard();

CREATE TRIGGER trg_stock_balances_no_truncate
  BEFORE TRUNCATE ON stock_balances
  EXECUTE FUNCTION fn_raise_immutable();
