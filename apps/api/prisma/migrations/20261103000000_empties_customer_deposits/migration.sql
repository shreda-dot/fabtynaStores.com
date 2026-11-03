-- Customer crate deposits.
--
-- A deposit is money a customer pays when taking crates without bringing
-- empties. It is held for the customer in ONE system "holding" account, so it
-- never mixes with the business's own cash. It is not revenue, profit or an
-- expense. A refund pays it back out of the holding account; a forfeit moves it
-- into a normal account (a real account transfer) and writes a KEPT row in
-- empties_customer_movements so the crates owed drop by the same quantity.
--
-- Only NEW functions are created here. No existing function is replaced.

CREATE TYPE "EmptiesDepositMovementType" AS ENUM (
  'RECEIVED',
  'REFUNDED',
  'FORFEITED'
);

-- ---------------------------------------------------------------------
-- The holding account marker
-- ---------------------------------------------------------------------

ALTER TABLE accounts ADD COLUMN "isHolding" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX ux_accounts_single_holding
  ON accounts ((true))
  WHERE "isHolding";

-- The holding account is system-managed: it cannot be renamed, retyped,
-- deactivated or deleted, and no row can be flipped into or out of holding.
CREATE FUNCTION fn_accounts_holding_row_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."isHolding" THEN
      RAISE EXCEPTION 'The crate-deposit holding account cannot be deleted.';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."isHolding" OR NEW."isHolding" THEN
    IF NEW."isHolding" IS DISTINCT FROM OLD."isHolding"
       OR NEW."isActive" IS DISTINCT FROM OLD."isActive"
       OR NEW.name IS DISTINCT FROM OLD.name
       OR NEW.type IS DISTINCT FROM OLD.type THEN
      RAISE EXCEPTION 'The crate-deposit holding account is managed by the system and cannot be changed.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_accounts_holding_row_guard
  BEFORE UPDATE OR DELETE ON accounts
  FOR EACH ROW EXECUTE FUNCTION fn_accounts_holding_row_guard();

-- Only a deposit (ADJUSTMENT) or a forfeit (TRANSFER_OUT) may touch the holding
-- account. Reversals carry the same type as their target, so they pass too.
CREATE FUNCTION fn_account_holding_ledger_guard()
RETURNS trigger AS $$
BEGIN
  IF NEW.type::text NOT IN ('ADJUSTMENT', 'TRANSFER_OUT')
     AND EXISTS (
       SELECT 1 FROM accounts WHERE id = NEW."accountId" AND "isHolding"
     ) THEN
    RAISE EXCEPTION
      'The crate-deposit holding account only accepts crate deposits and forfeits (attempted %).',
      NEW.type::text;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_account_holding_ledger_guard
  BEFORE INSERT ON account_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION fn_account_holding_ledger_guard();

-- ---------------------------------------------------------------------
-- Deposit movements (immutable)
-- ---------------------------------------------------------------------

CREATE TABLE empties_deposit_movements (
  id TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "movementType" "EmptiesDepositMovementType" NOT NULL,
  "amountKobo" BIGINT NOT NULL,
  "accountEntryId" TEXT,
  "accountTransferId" TEXT,
  "customerMovementId" TEXT,
  note TEXT,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT NOT NULL,
  "reversesEntryId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT empties_deposit_movements_pkey PRIMARY KEY (id),
  CONSTRAINT fk_empties_deposit_movements_customer
    FOREIGN KEY ("customerId") REFERENCES customers (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_empties_deposit_movements_account_entry
    FOREIGN KEY ("accountEntryId") REFERENCES account_ledger_entries (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_empties_deposit_movements_account_transfer
    FOREIGN KEY ("accountTransferId") REFERENCES account_transfers (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_empties_deposit_movements_customer_movement
    FOREIGN KEY ("customerMovementId") REFERENCES empties_customer_movements (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_empties_deposit_movements_created_by
    FOREIGN KEY ("createdById") REFERENCES admin_users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_empties_deposit_movements_reversal
    FOREIGN KEY ("reversesEntryId") REFERENCES empties_deposit_movements (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_empties_deposit_movements_amount_nonzero
    CHECK ("amountKobo" <> 0),
  CONSTRAINT ck_empties_deposit_movements_sign
    CHECK (
      "reversesEntryId" IS NOT NULL
      OR ("movementType" = 'RECEIVED' AND "amountKobo" > 0)
      OR ("movementType" IN ('REFUNDED', 'FORFEITED') AND "amountKobo" < 0)
    ),
  CONSTRAINT ck_empties_deposit_movements_links
    CHECK (
      (
        "movementType" IN ('RECEIVED', 'REFUNDED')
        AND "accountEntryId" IS NOT NULL
        AND "accountTransferId" IS NULL
        AND "customerMovementId" IS NULL
      )
      OR (
        "movementType" = 'FORFEITED'
        AND "accountEntryId" IS NULL
        AND "accountTransferId" IS NOT NULL
        AND "customerMovementId" IS NOT NULL
      )
    ),
  CONSTRAINT ck_empties_deposit_movements_note_required
    CHECK (
      "movementType" <> 'FORFEITED'
      OR (note IS NOT NULL AND btrim(note) <> '')
    )
);

CREATE INDEX empties_deposit_movements_customer_occurred_idx
  ON empties_deposit_movements ("customerId", "occurredAt", id);
CREATE INDEX empties_deposit_movements_occurred_idx
  ON empties_deposit_movements ("occurredAt", id);

CREATE UNIQUE INDEX ux_empties_deposit_movement_reversed_once
  ON empties_deposit_movements ("reversesEntryId")
  WHERE "reversesEntryId" IS NOT NULL;
CREATE UNIQUE INDEX ux_empties_deposit_movement_account_entry
  ON empties_deposit_movements ("accountEntryId")
  WHERE "accountEntryId" IS NOT NULL;
CREATE UNIQUE INDEX ux_empties_deposit_movement_customer_movement
  ON empties_deposit_movements ("customerMovementId")
  WHERE "customerMovementId" IS NOT NULL;
CREATE UNIQUE INDEX ux_empties_deposit_movement_forfeit_transfer
  ON empties_deposit_movements ("accountTransferId")
  WHERE "accountTransferId" IS NOT NULL AND "reversesEntryId" IS NULL;

CREATE TABLE empties_deposit_balances (
  "customerId" TEXT NOT NULL,
  "amountKobo" BIGINT NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT empties_deposit_balances_pkey PRIMARY KEY ("customerId"),
  CONSTRAINT fk_empties_deposit_balances_customer
    FOREIGN KEY ("customerId") REFERENCES customers (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_empties_deposit_balances_nonnegative CHECK ("amountKobo" >= 0)
);

-- Reconcile from the immutable source before installing the direct-write guard.
INSERT INTO empties_deposit_balances ("customerId", "amountKobo")
SELECT "customerId", SUM("amountKobo")
  FROM empties_deposit_movements
 GROUP BY "customerId"
HAVING SUM("amountKobo") >= 0;

CREATE FUNCTION fn_empties_deposit_movement_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is immutable; insert a reversal instead of %',
    TG_TABLE_NAME, TG_OP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_empties_deposit_movement_immutable
  BEFORE UPDATE OR DELETE ON empties_deposit_movements
  FOR EACH ROW EXECUTE FUNCTION fn_empties_deposit_movement_immutable();

CREATE TRIGGER trg_empties_deposit_movement_no_truncate
  BEFORE TRUNCATE ON empties_deposit_movements
  FOR EACH STATEMENT EXECUTE FUNCTION fn_empties_deposit_movement_immutable();

-- Every deposit row must point at the money (or the transfer plus crate row) it
-- stands for, with the same amount and customer. Reversal rows point at the
-- REVERSAL of their target's entry, so the same amount rule covers both.
CREATE FUNCTION fn_check_empties_deposit_links()
RETURNS trigger AS $$
DECLARE
  entry_account_id TEXT;
  entry_type TEXT;
  entry_amount BIGINT;
  transfer_from TEXT;
  transfer_amount BIGINT;
  crate_customer_id TEXT;
  crate_type TEXT;
BEGIN
  IF NEW."accountEntryId" IS NOT NULL THEN
    SELECT "accountId", type::text, "amountKobo"
      INTO entry_account_id, entry_type, entry_amount
      FROM account_ledger_entries
     WHERE id = NEW."accountEntryId";

    IF NOT FOUND
       OR entry_type <> 'ADJUSTMENT'
       OR entry_amount <> NEW."amountKobo"
       OR NOT EXISTS (
         SELECT 1 FROM accounts WHERE id = entry_account_id AND "isHolding"
       ) THEN
      RAISE EXCEPTION
        'A crate deposit must link to an ADJUSTMENT entry of the same amount on the holding account.';
    END IF;
  END IF;

  IF NEW."accountTransferId" IS NOT NULL THEN
    SELECT "fromAccountId", "amountKobo"
      INTO transfer_from, transfer_amount
      FROM account_transfers
     WHERE id = NEW."accountTransferId";

    IF NOT FOUND
       OR transfer_amount <> abs(NEW."amountKobo")
       OR NOT EXISTS (
         SELECT 1 FROM accounts WHERE id = transfer_from AND "isHolding"
       ) THEN
      RAISE EXCEPTION
        'A crate deposit forfeit must link to a transfer of the same amount out of the holding account.';
    END IF;
  END IF;

  IF NEW."customerMovementId" IS NOT NULL THEN
    SELECT "customerId", "movementType"::text
      INTO crate_customer_id, crate_type
      FROM empties_customer_movements
     WHERE id = NEW."customerMovementId";

    IF NOT FOUND
       OR crate_type <> 'KEPT'
       OR crate_customer_id IS DISTINCT FROM NEW."customerId" THEN
      RAISE EXCEPTION
        'A crate deposit forfeit must link to a KEPT crate movement for the same customer.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_empties_deposit_movement_links
  BEFORE INSERT ON empties_deposit_movements
  FOR EACH ROW EXECUTE FUNCTION fn_check_empties_deposit_links();

CREATE FUNCTION fn_check_empties_deposit_reversal_integrity()
RETURNS trigger AS $$
DECLARE
  target_json JSONB;
  target_amount BIGINT;
  target_entry_id TEXT;
  target_crate_id TEXT;
  excluded_columns TEXT[] := ARRAY[
    'id', 'occurredAt', 'createdAt', 'reversesEntryId', 'createdById',
    'accountEntryId', 'customerMovementId'
  ];
BEGIN
  IF NEW."reversesEntryId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT to_jsonb(t)
    INTO target_json
    FROM empties_deposit_movements t
   WHERE t.id = NEW."reversesEntryId";

  IF target_json IS NULL THEN
    RAISE EXCEPTION 'Reversal target % not found on empties_deposit_movements.',
      NEW."reversesEntryId";
  END IF;

  IF target_json ->> 'reversesEntryId' IS NOT NULL THEN
    RAISE EXCEPTION 'A reversal cannot itself be reversed.';
  END IF;

  target_amount := (target_json ->> 'amountKobo')::bigint;
  target_entry_id := target_json ->> 'accountEntryId';
  target_crate_id := target_json ->> 'customerMovementId';

  IF (to_jsonb(NEW) - excluded_columns) IS DISTINCT FROM (
    (target_json - excluded_columns)
    || jsonb_build_object('amountKobo', -target_amount)
  ) THEN
    RAISE EXCEPTION
      'A crate deposit reversal must negate the amount and match its target on type, customer, note and transfer.';
  END IF;

  IF target_entry_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM account_ledger_entries
     WHERE id = NEW."accountEntryId" AND "reversesEntryId" = target_entry_id
  ) THEN
    RAISE EXCEPTION
      'A crate deposit reversal must link to the reversal of its target''s account entry.';
  END IF;

  IF target_crate_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM empties_customer_movements
     WHERE id = NEW."customerMovementId" AND "reversesEntryId" = target_crate_id
  ) THEN
    RAISE EXCEPTION
      'A crate deposit reversal must link to the reversal of its target''s crate movement.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_empties_deposit_movement_reversal_integrity
  BEFORE INSERT ON empties_deposit_movements
  FOR EACH ROW EXECUTE FUNCTION fn_check_empties_deposit_reversal_integrity();

-- UPDATE first, insert only when no row exists, retry after a concurrent
-- insert (see docs/backend-schema.md on the stock_balances fix).
CREATE FUNCTION fn_apply_empties_deposit_movement()
RETURNS trigger AS $$
DECLARE
  movement_amount BIGINT := NEW."amountKobo";
BEGIN
  LOOP
    UPDATE empties_deposit_balances
       SET "amountKobo" = "amountKobo" + movement_amount,
           "updatedAt" = now()
     WHERE "customerId" = NEW."customerId";

    IF FOUND THEN
      RETURN NULL;
    END IF;

    BEGIN
      INSERT INTO empties_deposit_balances ("customerId", "amountKobo")
      VALUES (NEW."customerId", movement_amount);
      RETURN NULL;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_empties_deposit_movement_apply
  AFTER INSERT ON empties_deposit_movements
  FOR EACH ROW EXECUTE FUNCTION fn_apply_empties_deposit_movement();

CREATE FUNCTION fn_empties_deposit_balance_direct_write_guard()
RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION
      'empties_deposit_balances is derived from empties_deposit_movements and must not be written directly (attempted %).',
      TG_OP;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_empties_deposit_balances_guard
  BEFORE INSERT OR UPDATE OR DELETE ON empties_deposit_balances
  FOR EACH ROW EXECUTE FUNCTION fn_empties_deposit_balance_direct_write_guard();

CREATE FUNCTION fn_empties_deposit_balance_no_truncate()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'empties_deposit_balances is derived and cannot be truncated.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_empties_deposit_balances_no_truncate
  BEFORE TRUNCATE ON empties_deposit_balances
  FOR EACH STATEMENT EXECUTE FUNCTION fn_empties_deposit_balance_no_truncate();
