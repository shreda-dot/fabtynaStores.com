-- =====================================================================
-- Behavioural fixes for three triggers that passed `db:verify` but did
-- not do what they said
-- =====================================================================
-- `db:verify` only proves that objects EXIST and that applied migration
-- files are unedited. It cannot tell whether a PL/pgSQL body behaves. The
-- behavioural tests written afterwards
-- (`tests/reversal-positive.test.ts`, `tests/void-and-document-locks.test.ts`,
-- `tests/stock-balances.test.ts`) found three functions that were present,
-- named correctly, and wrong.
--
-- Nothing here is a schema change: every object keeps its name, so
-- `expected-schema.ts` gains only this migration's folder name. The three
-- applied migrations are left untouched, because `db:verify` checksums them.
--
--   A. fn_check_document_lock        -- text vs enum, 42883 on every update
--   B. fn_check_reversal_integrity   -- FOUND is not set by EXECUTE
--   C. fn_stock_balance_direct_write_guard -- guard never raised, and its
--                                             RETURN NULL cancelled every
--                                             write (so the balance table was
--                                             never maintained at all)
--
-- Prisma maps only *table* names via @@map; column names stay camelCase and
-- are therefore written as quoted camelCase identifiers below.

-- =====================================================================
-- A. Document lock: compare `status` through the jsonb row image
-- =====================================================================
-- `20261017110000_document_locks` declared
--     draft_status TEXT := 'DRAFT';
-- and compared it with `OLD.status IS DISTINCT FROM draft_status`.
-- `status` is a native enum ("SaleStatus" / "PurchaseStatus"), and
-- PostgreSQL has no implicit enum-to-text cast, so every UPDATE and DELETE
-- on sales/purchases died with
-- `operator does not exist: "SaleStatus" = text` (SQLSTATE 42883) before
-- the lock could be evaluated at all.
--
-- Reading the status out of `to_jsonb(OLD)` sidesteps the type entirely and
-- needs no per-table literal, which is the same trick the column allowlist
-- already uses.
CREATE OR REPLACE FUNCTION fn_check_document_lock()
RETURNS trigger AS $$
DECLARE
  allowed_columns TEXT[] := ARRAY['paidKobo', 'status', 'updatedAt'];
BEGIN
  -- A draft is the only deletable document, and the only fully editable one.
  IF (to_jsonb(OLD) ->> 'status') IS DISTINCT FROM 'DRAFT' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION
        'A % that is not a DRAFT cannot be deleted; void it instead (id=%).',
        TG_TABLE_NAME, OLD.id;
    END IF;

    IF (to_jsonb(NEW) - allowed_columns) IS DISTINCT FROM
       (to_jsonb(OLD) - allowed_columns) THEN
      RAISE EXCEPTION
        'A completed % may only change paidKobo, status and updatedAt; another column was modified (id=%).',
        TG_TABLE_NAME, OLD.id;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- B. Reversal integrity: fetch the target as jsonb
-- =====================================================================
-- `20261017070000_reversal_sign_exemption` fetched the target with
--     EXECUTE format('SELECT * FROM %I WHERE id = $1', TG_TABLE_NAME)
--       INTO target_row USING NEW."reversesEntryId";
--     IF NOT FOUND THEN RAISE EXCEPTION 'Reversal target ... not found';
-- `FOUND` is set by SELECT INTO, PERFORM, the DML statements, FETCH and
-- FOR — NOT by EXECUTE. It therefore kept its previous value (false, since
-- FOUND starts false in each function call), and the check rejected EVERY
-- reversal, including the correct ones, with "target not found".
--
-- Selecting `to_jsonb(t)` straight into a JSONB variable removes the need
-- for FOUND at all: a missing target leaves the variable NULL. (The
-- intermediate RECORD had to go too — a RECORD renders as `(a,b,...)`,
-- which is not valid json, so `to_jsonb(record)` could not have been used
-- anyway.)
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

-- =====================================================================
-- C. stock_balances: reconcile, then repair the write guard
-- =====================================================================
-- `20261017100000_stock_balances` guarded the table with
--     IF pg_trigger_depth() = 0 THEN RAISE ...; END IF;
--     RETURN NULL;
-- Both halves were wrong:
--
--   * `pg_trigger_depth()` is 0 only when NOT in a trigger. Inside a
--     BEFORE ROW trigger fired by a client statement it is 1, and inside
--     the maintainer's own INSERT it is 2. So `= 0` was never true and the
--     guard never raised: a direct INSERT/UPDATE/DELETE was accepted.
--   * `RETURN NULL` from a BEFORE ROW trigger SILENTLY CANCELS the
--     operation. That included the maintainer's own
--     `INSERT ... ON CONFLICT DO UPDATE`, so every movement was recorded
--     and every balance was discarded: the table stayed empty, so
--     `ck_stock_balances_nonnegative` could never fire and the two
--     concurrent sales the migration exists to stop both succeeded.
--
-- The reconcile below has to happen with the old trigger out of the way:
-- as long as it is installed, its `RETURN NULL` swallows these writes too.
DROP TRIGGER trg_stock_balances_guard ON stock_balances;

DELETE FROM stock_balances;

-- Rebuild from the append-only log, which is the source of truth. Groups
-- whose net is negative are skipped rather than aborting the migration:
-- a negative net is itself residue from the window in which writes were
-- discarded, and `ck_stock_balances_nonnegative` would refuse to store it.
-- Such a group gets its row from the next movement.
INSERT INTO stock_balances ("productId", location, "quantityUnits")
SELECT "productId", location, SUM("quantityUnits")::integer
  FROM stock_movements
 GROUP BY "productId", location
HAVING SUM("quantityUnits") >= 0;

CREATE OR REPLACE FUNCTION fn_stock_balance_direct_write_guard()
RETURNS trigger AS $$
BEGIN
  -- Depth 1 == a client statement fired this trigger directly. Depth 2 or
  -- more == the statement came from fn_apply_stock_movement (itself a
  -- trigger function), which is the only writer allowed through.
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION
      'stock_balances is derived from stock_movements and must not be written directly (attempted %).',
      TG_OP;
  END IF;

  -- Returning NULL here would cancel the maintainer's write.
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stock_balances_guard
  BEFORE INSERT OR UPDATE OR DELETE ON stock_balances
  FOR EACH ROW EXECUTE FUNCTION fn_stock_balance_direct_write_guard();
