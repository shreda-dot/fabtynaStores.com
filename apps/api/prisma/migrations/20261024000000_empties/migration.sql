-- =====================================================================
-- Empties tracking, phase 1 — counts only
-- =====================================================================
-- Bottles and crates that leave with a customer and come back, or that get
-- returned to the brewery. These are COUNTS, never money: `unitValueKobo` is a
-- display-only figure and never enters a cash, sales or profit report.
--
-- Shape
-- -----
-- Four tables, one of them derived:
--
--   empties_owners     a user-managed list (brewery / supplier of empties)
--   empties_types      one kind of empties for an owner: BOTTLE or CRATE
--   empties_movements  the append-only log; IMMUTABLE, corrected by reversals
--   empties_balances   a DERIVED cache of SUM(empties_movements.quantity)
--
-- Only `empties_balances` is written by a trigger; nothing else may write it.
-- (`empties_owners` / `empties_types` mirror the `expense_categories`
-- conventions: user-managed, deactivated instead of deleted, no `code`
-- column because every row is user-managed.)
--
-- Order matters, exactly as in `20261017100000_stock_balances`: the tables are
-- created — and the balance cache reconciled — BEFORE the direct-write guard
-- is installed, because the reconcile INSERT would otherwise be rejected by
-- that guard.
--
-- Prisma maps only *table* names via @@map; column names stay camelCase and
-- are therefore written as quoted camelCase identifiers below.

-- =====================================================================
-- A. Enums
-- =====================================================================
CREATE TYPE "EmptiesKind" AS ENUM ('BOTTLE', 'CRATE');

CREATE TYPE "EmptiesMovementType" AS ENUM (
  'OPENING',
  'RECEIVED',
  'RETURNED_TO_OWNER',
  'ADJUSTMENT'
);

-- =====================================================================
-- B. Owners (user-managed list)
-- =====================================================================
CREATE TABLE empties_owners (
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  "normalizedKey" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT empties_owners_pkey PRIMARY KEY (id),
  CONSTRAINT ck_empties_owners_name CHECK (
    char_length(btrim(name)) BETWEEN 1 AND 60
  ),
  CONSTRAINT ck_empties_owners_normalized_key CHECK (
    "normalizedKey" = lower(btrim(name))
  )
);

CREATE UNIQUE INDEX empties_owners_normalizedKey_key
  ON empties_owners ("normalizedKey");

INSERT INTO empties_owners (id, name, "normalizedKey")
VALUES
  ('sys-empties-owner-intl-breweries', 'International Breweries', 'international breweries'),
  ('sys-empties-owner-nigerian-breweries', 'Nigerian Breweries', 'nigerian breweries'),
  ('sys-empties-owner-guinness-nigeria', 'Guinness Nigeria', 'guinness nigeria')
ON CONFLICT ("normalizedKey") DO NOTHING;

-- An owner is deactivated, never deleted: `empties_types` references it with
-- ON DELETE RESTRICT, and history must keep naming it.
CREATE OR REPLACE FUNCTION fn_empties_owner_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Empties owners cannot be deleted; deactivate them instead.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_empties_owner_guard
  BEFORE UPDATE OR DELETE ON empties_owners
  FOR EACH ROW EXECUTE FUNCTION fn_empties_owner_guard();

CREATE TRIGGER trg_empties_owner_no_truncate
  BEFORE TRUNCATE ON empties_owners
  EXECUTE FUNCTION fn_raise_immutable();

-- =====================================================================
-- C. Types
-- =====================================================================
-- `unitValueKobo` is display-only and nullable: a type without a value still
-- tracks its count, it just cannot be valued. Uniqueness is per
-- (owner, kind, case/space-insensitive label), enforced by an expression
-- index so no extra `normalizedKey` column is needed.
CREATE TABLE empties_types (
  id TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  kind "EmptiesKind" NOT NULL,
  label TEXT NOT NULL,
  "unitValueKobo" BIGINT,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT empties_types_pkey PRIMARY KEY (id),
  CONSTRAINT fk_empties_types_owner
    FOREIGN KEY ("ownerId") REFERENCES empties_owners (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_empties_types_label CHECK (
    char_length(btrim(label)) BETWEEN 1 AND 40
  ),
  CONSTRAINT ck_empties_types_unit_value_nonnegative CHECK (
    "unitValueKobo" IS NULL OR "unitValueKobo" >= 0
  )
);

CREATE UNIQUE INDEX empties_types_owner_kind_label_key
  ON empties_types ("ownerId", kind, lower(btrim(label)));

-- `ownerId` and `kind` are immutable once a type exists: a movement's history
-- is only meaningful against the same owner and kind. `label` and
-- `unitValueKobo` stay editable.
CREATE OR REPLACE FUNCTION fn_empties_type_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Empties types cannot be deleted; deactivate them instead.';
  END IF;

  IF NEW."ownerId" IS DISTINCT FROM OLD."ownerId" THEN
    RAISE EXCEPTION
      'empties_types.ownerId is immutable once created (was %, attempted %).',
      OLD."ownerId", NEW."ownerId";
  END IF;

  IF NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION
      'empties_types.kind is immutable once created (was %, attempted %).',
      OLD.kind, NEW.kind;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_empties_type_guard
  BEFORE UPDATE OR DELETE ON empties_types
  FOR EACH ROW EXECUTE FUNCTION fn_empties_type_guard();

CREATE TRIGGER trg_empties_type_no_truncate
  BEFORE TRUNCATE ON empties_types
  EXECUTE FUNCTION fn_raise_immutable();

-- =====================================================================
-- D. Movements (append-only log)
-- =====================================================================
CREATE TABLE empties_movements (
  id TEXT NOT NULL,
  "typeId" TEXT NOT NULL,
  "movementType" "EmptiesMovementType" NOT NULL,
  quantity INTEGER NOT NULL,
  note TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT NOT NULL,
  "reversesEntryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT empties_movements_pkey PRIMARY KEY (id),
  CONSTRAINT fk_empties_movements_type
    FOREIGN KEY ("typeId") REFERENCES empties_types (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_empties_movements_created_by
    FOREIGN KEY ("createdById") REFERENCES admin_users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT empties_movements_reversesEntryId_fkey
    FOREIGN KEY ("reversesEntryId") REFERENCES empties_movements (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_empties_movements_quantity_nonzero CHECK (quantity <> 0),
  -- ADJUSTMENT is the only manual movement type, so it must say why.
  CONSTRAINT ck_empties_movements_note_required CHECK (
    "movementType" <> 'ADJUSTMENT'
    OR (note IS NOT NULL AND btrim(note) <> '')
  ),
  -- A reversal row copies its target and negates only `quantity`, so it is
  -- exempt from the sign rule; `trg_empties_movement_reversal_integrity`
  -- proves it really is the negation of a real target.
  CONSTRAINT ck_empties_movements_sign CHECK (
    "reversesEntryId" IS NOT NULL
    OR ("movementType" IN ('OPENING', 'RECEIVED') AND quantity > 0)
    OR ("movementType" = 'RETURNED_TO_OWNER' AND quantity < 0)
    OR ("movementType" = 'ADJUSTMENT' AND quantity <> 0)
  )
);

CREATE INDEX empties_movements_typeId_occurredAt_idx
  ON empties_movements ("typeId", "occurredAt");
CREATE INDEX empties_movements_occurredAt_idx
  ON empties_movements ("occurredAt");
CREATE INDEX empties_movements_reversesEntryId_idx
  ON empties_movements ("reversesEntryId");

-- At most one live opening count per type. A reversed opening leaves the
-- partial index (its reversal row carries a reversesEntryId), so a fresh
-- OPENING can be recorded afterwards.
CREATE UNIQUE INDEX ux_empties_movement_opening_active
  ON empties_movements ("typeId")
  WHERE "movementType" = 'OPENING' AND "reversesEntryId" IS NULL;

-- A given row can be reversed at most once.
CREATE UNIQUE INDEX ux_empties_movement_reversed_once
  ON empties_movements ("reversesEntryId")
  WHERE "reversesEntryId" IS NOT NULL;

-- ---------- immutability ----------
CREATE TRIGGER trg_empties_movement_immutable
  BEFORE UPDATE OR DELETE ON empties_movements
  FOR EACH ROW EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_empties_movement_no_truncate
  BEFORE TRUNCATE ON empties_movements
  EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_empties_movement_reversal_target
  BEFORE INSERT ON empties_movements
  FOR EACH ROW EXECUTE FUNCTION fn_check_reversal_target();

-- A movement may only be recorded against an ACTIVE type. A reversal row is
-- exempt: the type may have been deactivated after the movement it undoes.
CREATE OR REPLACE FUNCTION fn_check_empties_type_active()
RETURNS trigger AS $$
DECLARE
  type_active BOOLEAN;
BEGIN
  IF NEW."reversesEntryId" IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT "isActive" INTO type_active
    FROM empties_types
   WHERE id = NEW."typeId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Empties type % does not exist.', NEW."typeId";
  END IF;

  IF NOT type_active THEN
    RAISE EXCEPTION
      'Empties type % is deactivated and cannot receive new movements.',
      NEW."typeId";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_empties_movement_type_active
  BEFORE INSERT ON empties_movements
  FOR EACH ROW EXECUTE FUNCTION fn_check_empties_type_active();

-- =====================================================================
-- E. Reversal integrity for empties_movements (extend the shared function)
-- =====================================================================
-- `fn_check_reversal_integrity` (rewritten in `20261017120000`) hard-coded the
-- magnitude column for every table except `stock_movements`. Empties movements
-- use `quantity`, so the CASE gains one more branch.
--
-- The excluded-column list also gains `createdById`: it is an ACTOR column,
-- not a source column — a reversal is created by whoever performed it, and the
-- acting admin is recorded in `audit_logs`. Adding the name is a no-op for the
-- five existing tables (`jsonb - text[]` only removes keys that exist, and none
-- of them has a `createdById`), so no installed behaviour changes.
--
-- This CREATE OR REPLACE is the same body as `20261017120000`, so the trigger
-- functions that already use it keep behaving identically.
CREATE OR REPLACE FUNCTION fn_check_reversal_integrity()
RETURNS trigger AS $$
DECLARE
  target_json JSONB;
  magnitude_column TEXT;
  magnitude_value BIGINT;
  excluded_columns TEXT[] := ARRAY['id', 'occurredAt', 'createdAt', 'reversesEntryId', 'createdById'];
BEGIN
  IF NEW."reversesEntryId" IS NULL THEN
    RETURN NEW;
  END IF;

  magnitude_column :=
    CASE TG_TABLE_NAME
      WHEN 'stock_movements' THEN 'quantityUnits'
      WHEN 'empties_movements' THEN 'quantity'
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

CREATE TRIGGER trg_empties_movement_reversal_integrity
  BEFORE INSERT ON empties_movements
  FOR EACH ROW EXECUTE FUNCTION fn_check_reversal_integrity();

-- =====================================================================
-- F. Balances (derived)
-- =====================================================================
CREATE TABLE empties_balances (
  "typeId" TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT empties_balances_pkey PRIMARY KEY ("typeId"),
  CONSTRAINT fk_empties_balances_type
    FOREIGN KEY ("typeId") REFERENCES empties_types (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_empties_balances_nonnegative CHECK (quantity >= 0)
);

-- Reconcile from the append-only log, which is the source of truth. Both
-- tables are new in this migration, so this is a no-op today; it is here so
-- the invariant "the cache equals the log" is stated in SQL and so the
-- ordering (reconcile BEFORE the guard) matches `20261017130000`.
INSERT INTO empties_balances ("typeId", quantity)
SELECT "typeId", SUM(quantity)::integer
  FROM empties_movements
 GROUP BY "typeId"
HAVING SUM(quantity) >= 0;

-- ---------------------------------------------------------------------
-- Maintainer: the ONLY writer of empties_balances
-- ---------------------------------------------------------------------
-- UPDATE-first, then insert only when no row exists, retrying after a
-- concurrent first insert. `INSERT ... ON CONFLICT DO UPDATE` is wrong here
-- for the same reason it was wrong for stock: Postgres evaluates the proposed
-- tuple's `quantity >= 0` CHECK BEFORE unique-index arbitration, so it would
-- reject every legal negative movement (a return to the owner, or the reversal
-- of an opening) even when the merged balance stays positive.
CREATE OR REPLACE FUNCTION fn_apply_empties_movement() RETURNS trigger AS $$
DECLARE
  movement_quantity INTEGER := NEW.quantity;
BEGIN
  LOOP
    UPDATE empties_balances
       SET quantity = quantity + movement_quantity,
           "updatedAt" = now()
     WHERE "typeId" = NEW."typeId";

    IF FOUND THEN
      RETURN NULL;
    END IF;

    BEGIN
      INSERT INTO empties_balances ("typeId", quantity)
      VALUES (NEW."typeId", movement_quantity);
      RETURN NULL;
    EXCEPTION WHEN unique_violation THEN
      -- Another session created this row between the UPDATE and the INSERT.
      -- Loop: the UPDATE finds it now and the arithmetic happens under its
      -- row lock.
      NULL;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_empties_movement_apply
  AFTER INSERT ON empties_movements
  FOR EACH ROW EXECUTE FUNCTION fn_apply_empties_movement();

-- ---------------------------------------------------------------------
-- Guard: reject any write that did not come from the trigger above
-- ---------------------------------------------------------------------
-- `pg_trigger_depth()` is 1 for a client statement that fired this trigger
-- directly and >= 2 when the writer is the maintainer trigger function. The
-- `20261017100000` spelling (`= 0` with `RETURN NULL`) never raised and
-- cancelled every real write; this is the corrected form.
CREATE OR REPLACE FUNCTION fn_empties_balance_direct_write_guard()
RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION
      'empties_balances is derived from empties_movements and must not be written directly (attempted %).',
      TG_OP;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_empties_balances_guard
  BEFORE INSERT OR UPDATE OR DELETE ON empties_balances
  FOR EACH ROW EXECUTE FUNCTION fn_empties_balance_direct_write_guard();

CREATE TRIGGER trg_empties_balances_no_truncate
  BEFORE TRUNCATE ON empties_balances
  EXECUTE FUNCTION fn_raise_immutable();
