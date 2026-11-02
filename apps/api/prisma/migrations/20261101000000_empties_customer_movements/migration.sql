-- Customer-owned empties are tracked independently from the business's
-- on-hand empties balance. RETURNED rows are paired transactionally by the
-- API with a RECEIVED empties_movements row.

CREATE TYPE "EmptiesCustomerMovementType" AS ENUM (
  'TAKEN',
  'RETURNED',
  'KEPT',
  'ADJUSTMENT'
);

CREATE TABLE empties_customer_movements (
  id TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "typeId" TEXT NOT NULL,
  "movementType" "EmptiesCustomerMovementType" NOT NULL,
  quantity INTEGER NOT NULL,
  note TEXT,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT NOT NULL,
  "emptiesMovementId" TEXT,
  "reversesEntryId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT empties_customer_movements_pkey PRIMARY KEY (id),
  CONSTRAINT fk_empties_customer_movements_customer
    FOREIGN KEY ("customerId") REFERENCES customers (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_empties_customer_movements_type
    FOREIGN KEY ("typeId") REFERENCES empties_types (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_empties_customer_movements_created_by
    FOREIGN KEY ("createdById") REFERENCES admin_users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_empties_customer_movements_empties_movement
    FOREIGN KEY ("emptiesMovementId") REFERENCES empties_movements (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_empties_customer_movements_reversal
    FOREIGN KEY ("reversesEntryId") REFERENCES empties_customer_movements (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_empties_customer_movements_quantity_nonzero
    CHECK (quantity <> 0),
  CONSTRAINT ck_empties_customer_movements_note_required
    CHECK (
      "movementType" NOT IN ('KEPT', 'ADJUSTMENT')
      OR (note IS NOT NULL AND btrim(note) <> '')
    ),
  CONSTRAINT ck_empties_customer_movements_sign
    CHECK (
      "reversesEntryId" IS NOT NULL
      OR ("movementType" = 'TAKEN' AND quantity > 0)
      OR ("movementType" IN ('RETURNED', 'KEPT') AND quantity < 0)
      OR ("movementType" = 'ADJUSTMENT' AND quantity <> 0)
    ),
  CONSTRAINT ck_empties_customer_movements_return_link
    CHECK (
      ("movementType" = 'RETURNED' AND "emptiesMovementId" IS NOT NULL)
      OR ("movementType" <> 'RETURNED' AND "emptiesMovementId" IS NULL)
    )
);

CREATE INDEX empties_customer_movements_customer_type_occurred_idx
  ON empties_customer_movements ("customerId", "typeId", "occurredAt", id);
CREATE INDEX empties_customer_movements_type_occurred_idx
  ON empties_customer_movements ("typeId", "occurredAt", id);
CREATE INDEX empties_customer_movements_empties_movement_idx
  ON empties_customer_movements ("emptiesMovementId");

CREATE UNIQUE INDEX ux_empties_customer_movement_reversed_once
  ON empties_customer_movements ("reversesEntryId")
  WHERE "reversesEntryId" IS NOT NULL;
CREATE UNIQUE INDEX ux_empties_customer_movement_received_link
  ON empties_customer_movements ("emptiesMovementId")
  WHERE "movementType" = 'RETURNED'
    AND "reversesEntryId" IS NULL
    AND "emptiesMovementId" IS NOT NULL;

CREATE TABLE empties_customer_balances (
  "customerId" TEXT NOT NULL,
  "typeId" TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT empties_customer_balances_pkey PRIMARY KEY ("customerId", "typeId"),
  CONSTRAINT fk_empties_customer_balances_customer
    FOREIGN KEY ("customerId") REFERENCES customers (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_empties_customer_balances_type
    FOREIGN KEY ("typeId") REFERENCES empties_types (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_empties_customer_balances_nonnegative CHECK (quantity >= 0)
);

CREATE INDEX empties_customer_balances_type_customer_idx
  ON empties_customer_balances ("typeId", "customerId");

-- Reconcile from the immutable source before installing the direct-write guard.
INSERT INTO empties_customer_balances ("customerId", "typeId", quantity)
SELECT "customerId", "typeId", SUM(quantity)::integer
  FROM empties_customer_movements
 GROUP BY "customerId", "typeId"
HAVING SUM(quantity) >= 0;

CREATE FUNCTION fn_empties_customer_movement_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is immutable; insert a reversal instead of %',
    TG_TABLE_NAME, TG_OP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_empties_customer_movement_immutable
  BEFORE UPDATE OR DELETE ON empties_customer_movements
  FOR EACH ROW EXECUTE FUNCTION fn_empties_customer_movement_immutable();

CREATE TRIGGER trg_empties_customer_movement_no_truncate
  BEFORE TRUNCATE ON empties_customer_movements
  FOR EACH STATEMENT EXECUTE FUNCTION fn_empties_customer_movement_immutable();

CREATE FUNCTION fn_check_empties_customer_return_link()
RETURNS trigger AS $$
DECLARE
  linked_type_id TEXT;
  linked_movement_type "EmptiesMovementType";
  linked_quantity INTEGER;
BEGIN
  IF NEW."emptiesMovementId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "typeId", "movementType", quantity
    INTO linked_type_id, linked_movement_type, linked_quantity
    FROM empties_movements
   WHERE id = NEW."emptiesMovementId";

  IF NOT FOUND
     OR linked_movement_type <> 'RECEIVED'
     OR linked_type_id IS DISTINCT FROM NEW."typeId"
     OR linked_quantity::bigint <> abs(NEW.quantity::bigint) THEN
    RAISE EXCEPTION
      'A customer RETURNED movement must link to a matching RECEIVED empties movement.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_empties_customer_movement_return_link
  BEFORE INSERT ON empties_customer_movements
  FOR EACH ROW EXECUTE FUNCTION fn_check_empties_customer_return_link();

CREATE FUNCTION fn_check_empties_customer_movement_reversal_integrity()
RETURNS trigger AS $$
DECLARE
  target_json JSONB;
  target_quantity INTEGER;
  excluded_columns TEXT[] := ARRAY[
    'id', 'occurredAt', 'createdAt', 'reversesEntryId', 'createdById'
  ];
BEGIN
  IF NEW."reversesEntryId" IS NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format(
    'SELECT to_jsonb(t) FROM %I t WHERE id = $1',
    TG_TABLE_NAME
  )
    INTO target_json
    USING NEW."reversesEntryId";

  IF target_json IS NULL THEN
    RAISE EXCEPTION 'Reversal target % not found on %.',
      NEW."reversesEntryId", TG_TABLE_NAME;
  END IF;

  IF target_json ->> 'reversesEntryId' IS NOT NULL THEN
    RAISE EXCEPTION 'A reversal cannot itself be reversed.';
  END IF;

  target_quantity := (target_json ->> 'quantity')::integer;

  IF (to_jsonb(NEW) - excluded_columns) IS DISTINCT FROM (
    (target_json - excluded_columns)
    || jsonb_build_object('quantity', -target_quantity)
  ) THEN
    RAISE EXCEPTION
      'A customer empties reversal must negate quantity and match its target on type and every source column.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_empties_customer_movement_reversal_integrity
  BEFORE INSERT ON empties_customer_movements
  FOR EACH ROW EXECUTE FUNCTION fn_check_empties_customer_movement_reversal_integrity();

CREATE FUNCTION fn_apply_empties_customer_movement()
RETURNS trigger AS $$
DECLARE
  movement_quantity INTEGER := NEW.quantity;
BEGIN
  LOOP
    UPDATE empties_customer_balances
       SET quantity = quantity + movement_quantity,
           "updatedAt" = now()
     WHERE "customerId" = NEW."customerId"
       AND "typeId" = NEW."typeId";

    IF FOUND THEN
      RETURN NULL;
    END IF;

    BEGIN
      INSERT INTO empties_customer_balances ("customerId", "typeId", quantity)
      VALUES (NEW."customerId", NEW."typeId", movement_quantity);
      RETURN NULL;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_empties_customer_movement_apply
  AFTER INSERT ON empties_customer_movements
  FOR EACH ROW EXECUTE FUNCTION fn_apply_empties_customer_movement();

CREATE FUNCTION fn_empties_customer_balance_direct_write_guard()
RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION
      'empties_customer_balances is derived from empties_customer_movements and must not be written directly (attempted %).',
      TG_OP;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_empties_customer_balances_guard
  BEFORE INSERT OR UPDATE OR DELETE ON empties_customer_balances
  FOR EACH ROW EXECUTE FUNCTION fn_empties_customer_balance_direct_write_guard();

CREATE FUNCTION fn_empties_customer_balance_no_truncate()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'empties_customer_balances is derived and cannot be truncated.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_empties_customer_balances_no_truncate
  BEFORE TRUNCATE ON empties_customer_balances
  FOR EACH STATEMENT EXECUTE FUNCTION fn_empties_customer_balance_no_truncate();
