-- REVIEW DRAFT ONLY: DO NOT APPLY without the owner's approval.
-- Parsed offline, but not applied or behavior-tested against any database.
-- The associated API and Prisma models are not implemented yet.
--
-- Existing purchases retain NULL in emptiesTrackingVersion. New purchases get
-- version 1; an insert guard is still required to prevent explicit NULL.
ALTER TABLE purchases ADD COLUMN "emptiesTrackingVersion" INTEGER;
ALTER TABLE purchases ALTER COLUMN "emptiesTrackingVersion" SET DEFAULT 1;
ALTER TABLE purchases ADD COLUMN "emptiesCreationTxid" BIGINT;
ALTER TABLE purchases ALTER COLUMN "emptiesCreationTxid" SET DEFAULT txid_current();
ALTER TABLE purchases ADD COLUMN "emptiesReceiptTxid" BIGINT;
ALTER TABLE purchases ADD CONSTRAINT ck_purchase_empties_tracking_version
  CHECK ("emptiesTrackingVersion" IS NULL OR "emptiesTrackingVersion" = 1);

CREATE TYPE "PurchaseEmptiesClassification" AS ENUM ('RETURNABLE', 'NON_RETURNABLE');
CREATE TYPE "SupplierEmptiesEventType" AS ENUM (
  'RETURNED_FOR_PURCHASE',
  'SUPPLIED_FREE',
  'PURCHASE_DEBT',
  'OPENING_DEBT',
  'DEBT_SETTLEMENT'
);

-- Missing classification is unknown, never silently treated as non-returnable.
CREATE TABLE purchase_empties_products (
  "productId" TEXT NOT NULL,
  classification "PurchaseEmptiesClassification" NOT NULL,
  CONSTRAINT purchase_empties_products_pkey PRIMARY KEY ("productId"),
  CONSTRAINT fk_purchase_empties_products_product FOREIGN KEY ("productId")
    REFERENCES products(id) ON DELETE RESTRICT
);

-- Crates and bottles are configured separately, using exact brewery-owned types.
-- For bottles countPerUnit is bottles per base unit. For crates countPerPack is
-- crates per full pack; partial packs and single-unit lines use an entered count.
CREATE TABLE purchase_empties_packaging (
  "productId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "typeId" TEXT NOT NULL,
  kind "EmptiesKind" NOT NULL,
  "countPerUnit" INTEGER,
  "countPerPack" INTEGER,
  CONSTRAINT purchase_empties_packaging_pkey PRIMARY KEY ("productId", kind),
  CONSTRAINT fk_purchase_empties_packaging_owner FOREIGN KEY ("productId", "ownerId")
    REFERENCES empties_product_owners ("productId", "ownerId") ON DELETE RESTRICT,
  CONSTRAINT fk_purchase_empties_packaging_type FOREIGN KEY ("ownerId", "typeId", kind)
    REFERENCES empties_types ("ownerId", id, kind) ON DELETE RESTRICT,
  CONSTRAINT ck_purchase_empties_packaging_counts CHECK (
    (kind = 'BOTTLE' AND "countPerUnit" IS NOT NULL
      AND "countPerUnit" > 0 AND "countPerPack" IS NULL)
    OR (kind = 'CRATE' AND "countPerPack" IS NOT NULL
      AND "countPerPack" > 0 AND "countPerUnit" IS NULL)
  )
);

-- Immutable line snapshot. Zero is meaningful for a manually counted crate
-- line, because the supplier may deliver loose units without a crate.
CREATE TABLE purchase_empties_line_snapshots (
  "purchaseLineId" TEXT NOT NULL,
  classification "PurchaseEmptiesClassification" NOT NULL,
  CONSTRAINT purchase_empties_line_snapshots_pkey PRIMARY KEY ("purchaseLineId"),
  CONSTRAINT fk_purchase_empties_line_snapshots_line FOREIGN KEY ("purchaseLineId")
    REFERENCES purchase_lines(id) ON DELETE RESTRICT
);

CREATE TABLE purchase_empties_requirements (
  "purchaseLineId" TEXT NOT NULL,
  "typeId" TEXT NOT NULL,
  kind "EmptiesKind" NOT NULL,
  quantity INTEGER NOT NULL,
  "manualCrateCount" BOOLEAN NOT NULL DEFAULT FALSE,
  "countPerUnitSnapshot" INTEGER,
  "countPerPackSnapshot" INTEGER,
  CONSTRAINT purchase_empties_requirements_pkey PRIMARY KEY ("purchaseLineId", kind),
  CONSTRAINT fk_purchase_empties_requirements_line FOREIGN KEY ("purchaseLineId")
    REFERENCES purchase_lines(id) ON DELETE RESTRICT,
  CONSTRAINT fk_purchase_empties_requirements_type FOREIGN KEY ("typeId")
    REFERENCES empties_types(id) ON DELETE RESTRICT,
  CONSTRAINT ck_purchase_empties_requirement_nonnegative CHECK (quantity >= 0),
  CONSTRAINT ck_purchase_empties_requirement_rates CHECK (
    (kind = 'BOTTLE' AND "countPerUnitSnapshot" IS NOT NULL AND "countPerUnitSnapshot" > 0
      AND "countPerPackSnapshot" IS NULL AND NOT "manualCrateCount")
    OR (kind = 'CRATE' AND "countPerPackSnapshot" IS NOT NULL AND "countPerPackSnapshot" > 0
      AND "countPerUnitSnapshot" IS NULL)
  )
);

-- A locked, server-recorded on-hand snapshot for each required type. This is
-- per purchase/type, not per line, so compatible repeated lines are combined.
CREATE TABLE purchase_empties_checks (
  "purchaseId" TEXT NOT NULL,
  "typeId" TEXT NOT NULL,
  "availableQuantity" INTEGER NOT NULL,
  "capturedTxid" BIGINT NOT NULL,
  CONSTRAINT purchase_empties_checks_pkey PRIMARY KEY ("purchaseId", "typeId"),
  CONSTRAINT fk_purchase_empties_checks_purchase FOREIGN KEY ("purchaseId")
    REFERENCES purchases(id) ON DELETE RESTRICT,
  CONSTRAINT fk_purchase_empties_checks_type FOREIGN KEY ("typeId")
    REFERENCES empties_types(id) ON DELETE RESTRICT,
  CONSTRAINT ck_purchase_empties_checks_nonnegative CHECK ("availableQuantity" >= 0)
);

-- An obligation is allocated to one purchase or explicitly entered as opening
-- debt. Its supplier and exact type are fixed for the life of the obligation.
CREATE TABLE supplier_empties_obligations (
  id TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "typeId" TEXT NOT NULL,
  "purchaseId" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT supplier_empties_obligations_pkey PRIMARY KEY (id),
  CONSTRAINT fk_supplier_empties_obligations_supplier FOREIGN KEY ("supplierId")
    REFERENCES suppliers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_supplier_empties_obligations_type FOREIGN KEY ("typeId")
    REFERENCES empties_types(id) ON DELETE RESTRICT,
  CONSTRAINT fk_supplier_empties_obligations_purchase FOREIGN KEY ("purchaseId")
    REFERENCES purchases(id) ON DELETE RESTRICT,
  CONSTRAINT fk_supplier_empties_obligations_actor FOREIGN KEY ("createdById")
    REFERENCES admin_users(id) ON DELETE RESTRICT
);

-- The original return and settlement events must each own one matching
-- on-hand movement. Their exact reversals must be paired at transaction commit.
-- Supplied-free events are history only and never add to on-hand inventory.
CREATE TABLE supplier_empties_events (
  id TEXT NOT NULL,
  "eventType" "SupplierEmptiesEventType" NOT NULL,
  "typeId" TEXT NOT NULL,
  "purchaseId" TEXT,
  "obligationId" TEXT,
  quantity INTEGER NOT NULL,
  "reversesEntryId" TEXT,
  note TEXT,
  "createdById" TEXT NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT supplier_empties_events_pkey PRIMARY KEY (id),
  CONSTRAINT fk_supplier_empties_events_type FOREIGN KEY ("typeId")
    REFERENCES empties_types(id) ON DELETE RESTRICT,
  CONSTRAINT fk_supplier_empties_events_purchase FOREIGN KEY ("purchaseId")
    REFERENCES purchases(id) ON DELETE RESTRICT,
  CONSTRAINT fk_supplier_empties_events_obligation FOREIGN KEY ("obligationId")
    REFERENCES supplier_empties_obligations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_supplier_empties_events_reversal FOREIGN KEY ("reversesEntryId")
    REFERENCES supplier_empties_events(id) ON DELETE RESTRICT,
  CONSTRAINT fk_supplier_empties_events_actor FOREIGN KEY ("createdById")
    REFERENCES admin_users(id) ON DELETE RESTRICT,
  CONSTRAINT ck_supplier_empties_event_nonzero CHECK (quantity <> 0)
);

CREATE TABLE supplier_empties_obligation_balances (
  "obligationId" TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT supplier_empties_obligation_balances_pkey PRIMARY KEY ("obligationId"),
  CONSTRAINT fk_supplier_empties_balances_obligation FOREIGN KEY ("obligationId")
    REFERENCES supplier_empties_obligations(id) ON DELETE RESTRICT,
  CONSTRAINT ck_supplier_empties_balance_nonnegative CHECK (quantity >= 0)
);

ALTER TABLE empties_movements
  ADD COLUMN "supplierEmptiesEventId" TEXT,
  ADD CONSTRAINT fk_empties_movements_supplier_event
    FOREIGN KEY ("supplierEmptiesEventId")
    REFERENCES supplier_empties_events(id) ON DELETE RESTRICT;

ALTER TABLE empties_movements ADD CONSTRAINT ck_empties_supplier_event_source CHECK (
  "supplierEmptiesEventId" IS NULL
  OR ("saleId" IS NULL AND "movementType" = 'RETURNED_TO_OWNER')
);

ALTER TABLE supplier_empties_events ADD CONSTRAINT ck_supplier_empties_event_source CHECK (
  ("eventType" IN ('RETURNED_FOR_PURCHASE', 'SUPPLIED_FREE')
    AND "purchaseId" IS NOT NULL AND "obligationId" IS NULL)
  OR ("eventType" = 'PURCHASE_DEBT'
    AND "purchaseId" IS NOT NULL AND "obligationId" IS NOT NULL)
  OR ("eventType" = 'OPENING_DEBT'
    AND "purchaseId" IS NULL AND "obligationId" IS NOT NULL)
  OR ("eventType" = 'DEBT_SETTLEMENT' AND "obligationId" IS NOT NULL)
);

ALTER TABLE supplier_empties_events ADD CONSTRAINT ck_supplier_empties_event_sign CHECK (
  "reversesEntryId" IS NOT NULL
  OR ("eventType" IN ('RETURNED_FOR_PURCHASE', 'DEBT_SETTLEMENT') AND quantity < 0)
  OR ("eventType" IN ('SUPPLIED_FREE', 'PURCHASE_DEBT', 'OPENING_DEBT') AND quantity > 0)
);

ALTER TABLE supplier_empties_events ADD CONSTRAINT ck_supplier_empties_event_reason CHECK (
  ("eventType" <> 'OPENING_DEBT' AND "reversesEntryId" IS NULL)
  OR (note IS NOT NULL AND btrim(note) <> '')
);

CREATE UNIQUE INDEX ux_supplier_empties_event_reversal
  ON supplier_empties_events ("reversesEntryId")
  WHERE "reversesEntryId" IS NOT NULL;
CREATE UNIQUE INDEX ux_supplier_empties_obligation_origin
  ON supplier_empties_events ("obligationId")
  WHERE "eventType" IN ('PURCHASE_DEBT', 'OPENING_DEBT')
    AND "reversesEntryId" IS NULL;
CREATE UNIQUE INDEX ux_supplier_empties_purchase_event
  ON supplier_empties_events ("purchaseId", "typeId", "eventType")
  WHERE "eventType" IN ('RETURNED_FOR_PURCHASE', 'SUPPLIED_FREE', 'PURCHASE_DEBT')
    AND "reversesEntryId" IS NULL;
CREATE UNIQUE INDEX ux_empties_supplier_event_original
  ON empties_movements ("supplierEmptiesEventId")
  WHERE "supplierEmptiesEventId" IS NOT NULL AND "reversesEntryId" IS NULL;
CREATE INDEX supplier_empties_obligations_supplier_type_created_idx
  ON supplier_empties_obligations ("supplierId", "typeId", "createdAt", id);
CREATE INDEX supplier_empties_events_obligation_created_idx
  ON supplier_empties_events ("obligationId", "createdAt", id);
CREATE INDEX supplier_empties_events_purchase_type_idx
  ON supplier_empties_events ("purchaseId", "typeId");
CREATE INDEX purchase_lines_purchase_id_idx
  ON purchase_lines ("purchaseId");

CREATE TRIGGER trg_supplier_empties_obligation_immutable
  BEFORE UPDATE OR DELETE ON supplier_empties_obligations
  FOR EACH ROW EXECUTE FUNCTION fn_raise_immutable();
CREATE TRIGGER trg_supplier_empties_obligation_no_truncate
  BEFORE TRUNCATE ON supplier_empties_obligations
  FOR EACH STATEMENT EXECUTE FUNCTION fn_raise_immutable();
CREATE TRIGGER trg_supplier_empties_event_immutable
  BEFORE UPDATE OR DELETE ON supplier_empties_events
  FOR EACH ROW EXECUTE FUNCTION fn_raise_immutable();
CREATE TRIGGER trg_supplier_empties_event_no_truncate
  BEFORE TRUNCATE ON supplier_empties_events
  FOR EACH STATEMENT EXECUTE FUNCTION fn_raise_immutable();
CREATE TRIGGER trg_purchase_empties_requirement_immutable
  BEFORE UPDATE OR DELETE ON purchase_empties_requirements
  FOR EACH ROW EXECUTE FUNCTION fn_raise_immutable();
CREATE TRIGGER trg_purchase_empties_line_snapshot_immutable
  BEFORE UPDATE OR DELETE ON purchase_empties_line_snapshots
  FOR EACH ROW EXECUTE FUNCTION fn_raise_immutable();
CREATE TRIGGER trg_purchase_empties_line_snapshot_no_truncate
  BEFORE TRUNCATE ON purchase_empties_line_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION fn_raise_immutable();
CREATE TRIGGER trg_purchase_empties_requirement_no_truncate
  BEFORE TRUNCATE ON purchase_empties_requirements
  FOR EACH STATEMENT EXECUTE FUNCTION fn_raise_immutable();
CREATE TRIGGER trg_purchase_empties_check_immutable
  BEFORE UPDATE OR DELETE ON purchase_empties_checks
  FOR EACH ROW EXECUTE FUNCTION fn_raise_immutable();
CREATE TRIGGER trg_purchase_empties_check_no_truncate
  BEFORE TRUNCATE ON purchase_empties_checks
  FOR EACH STATEMENT EXECUTE FUNCTION fn_raise_immutable();

CREATE FUNCTION fn_purchase_empties_capture_available()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  available INTEGER;
BEGIN
  PERFORM 1 FROM purchases WHERE id = NEW."purchaseId" FOR UPDATE;
  PERFORM 1 FROM products p
   WHERE p.id IN (SELECT "productId" FROM purchase_lines WHERE "purchaseId" = NEW."purchaseId")
   ORDER BY p.id FOR UPDATE;
  PERFORM 1 FROM empties_types WHERE id = NEW."typeId" FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Empties type does not exist.'; END IF;
  SELECT quantity INTO available FROM empties_balances
    WHERE "typeId" = NEW."typeId" FOR UPDATE;
  NEW."availableQuantity" := COALESCE(available, 0);
  NEW."capturedTxid" := txid_current();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_purchase_empties_capture_available
  BEFORE INSERT ON purchase_empties_checks
  FOR EACH ROW EXECUTE FUNCTION fn_purchase_empties_capture_available();

CREATE FUNCTION fn_supplier_empties_event_reversal()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  original supplier_empties_events%ROWTYPE;
BEGIN
  IF NEW."reversesEntryId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO original FROM supplier_empties_events
    WHERE id = NEW."reversesEntryId";
  IF NOT FOUND OR original."reversesEntryId" IS NOT NULL
     OR (to_jsonb(NEW) - ARRAY['id', 'quantity', 'reversesEntryId', 'note',
                                'createdById', 'occurredAt', 'createdAt'])
        IS DISTINCT FROM
        (to_jsonb(original) - ARRAY['id', 'quantity', 'reversesEntryId', 'note',
                                     'createdById', 'occurredAt', 'createdAt'])
     OR NEW.quantity::bigint <> -original.quantity::bigint THEN
    RAISE EXCEPTION 'A supplier empties reversal must exactly negate its original event.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_supplier_empties_event_reversal
  BEFORE INSERT ON supplier_empties_events
  FOR EACH ROW EXECUTE FUNCTION fn_supplier_empties_event_reversal();

-- Only obligation events affect supplier debt. A failed non-negative CHECK
-- rolls back the event and any on-hand movement in the same transaction.
-- UPDATE first is essential: ON CONFLICT checks the proposed negative tuple
-- before applying the existing balance.
CREATE FUNCTION fn_apply_supplier_empties_event()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."obligationId" IS NULL THEN
    RETURN NULL;
  END IF;
  LOOP
    UPDATE supplier_empties_obligation_balances
       SET quantity = quantity + NEW.quantity, "updatedAt" = CURRENT_TIMESTAMP
     WHERE "obligationId" = NEW."obligationId";
    IF FOUND THEN RETURN NULL; END IF;
    BEGIN
      INSERT INTO supplier_empties_obligation_balances ("obligationId", quantity)
      VALUES (NEW."obligationId", NEW.quantity);
      RETURN NULL;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;
END;
$$;
CREATE TRIGGER trg_supplier_empties_event_apply
  AFTER INSERT ON supplier_empties_events
  FOR EACH ROW EXECUTE FUNCTION fn_apply_supplier_empties_event();

CREATE FUNCTION fn_supplier_empties_balance_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'Supplier empties balances are derived and cannot be written directly.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_supplier_empties_balance_guard
  BEFORE INSERT OR UPDATE OR DELETE ON supplier_empties_obligation_balances
  FOR EACH ROW EXECUTE FUNCTION fn_supplier_empties_balance_guard();
CREATE TRIGGER trg_supplier_empties_balance_no_truncate
  BEFORE TRUNCATE ON supplier_empties_obligation_balances
  FOR EACH STATEMENT EXECUTE FUNCTION fn_raise_immutable();

-- A settlement shares the purchase lock with void/amend. Obligations are
-- immutable, so the first read is safe; the lock order is purchase, then
-- obligation, then on-hand type/balance.
CREATE FUNCTION fn_supplier_empties_event_source()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  obligation supplier_empties_obligations%ROWTYPE;
  purchase purchases%ROWTYPE;
BEGIN
  IF NEW."obligationId" IS NOT NULL THEN
    SELECT * INTO obligation FROM supplier_empties_obligations
      WHERE id = NEW."obligationId";
    IF NOT FOUND THEN RAISE EXCEPTION 'Supplier empties obligation not found.'; END IF;
    IF NEW."typeId" IS DISTINCT FROM obligation."typeId"
       OR NEW."purchaseId" IS DISTINCT FROM obligation."purchaseId" THEN
      RAISE EXCEPTION 'Supplier empties event does not match its obligation.';
    END IF;
  END IF;
  IF NEW."purchaseId" IS NOT NULL THEN
    SELECT * INTO purchase FROM purchases WHERE id = NEW."purchaseId" FOR UPDATE;
    IF NOT FOUND OR purchase."emptiesTrackingVersion" IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'Supplier empties event needs a tracked purchase.';
    END IF;
    IF NEW."eventType" IN ('PURCHASE_DEBT', 'DEBT_SETTLEMENT')
       AND (purchase."supplierId" IS NULL
            OR purchase."supplierId" IS DISTINCT FROM obligation."supplierId") THEN
      RAISE EXCEPTION 'Supplier empties debt must match the purchase supplier.';
    END IF;
    IF NEW."eventType" = 'DEBT_SETTLEMENT' AND purchase.status <> 'RECEIVED' THEN
      RAISE EXCEPTION 'A voided purchase cannot receive an empties settlement.';
    END IF;
  END IF;
  IF NEW."obligationId" IS NOT NULL THEN
    PERFORM 1 FROM supplier_empties_obligations WHERE id = NEW."obligationId" FOR UPDATE;
    IF NEW."eventType" = 'DEBT_SETTLEMENT' AND NOT EXISTS (
      SELECT 1 FROM supplier_empties_events original
       WHERE original."obligationId" = NEW."obligationId"
         AND original."eventType" IN ('PURCHASE_DEBT', 'OPENING_DEBT')
         AND original."reversesEntryId" IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM supplier_empties_events reversed
            WHERE reversed."reversesEntryId" = original.id
         )
    ) THEN
      RAISE EXCEPTION 'A settlement requires a live supplier empties obligation.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_supplier_empties_event_source
  BEFORE INSERT ON supplier_empties_events
  FOR EACH ROW EXECUTE FUNCTION fn_supplier_empties_event_source();

CREATE FUNCTION fn_validate_supplier_empties_pair(event_id TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  original supplier_empties_events%ROWTYPE;
  inventory empties_movements%ROWTYPE;
  event_reversed BOOLEAN;
  inventory_reversed BOOLEAN;
BEGIN
  SELECT * INTO original FROM supplier_empties_events WHERE id = event_id;
  IF NOT FOUND OR original."reversesEntryId" IS NOT NULL THEN
    RAISE EXCEPTION 'On-hand movement must reference an original supplier empties event.';
  END IF;
  SELECT * INTO inventory FROM empties_movements
    WHERE "supplierEmptiesEventId" = original.id AND "reversesEntryId" IS NULL;
  IF original."eventType" NOT IN ('RETURNED_FOR_PURCHASE', 'DEBT_SETTLEMENT') THEN
    IF FOUND THEN RAISE EXCEPTION 'This supplier event must not move on-hand empties.'; END IF;
    RETURN;
  END IF;
  IF NOT FOUND OR inventory."typeId" IS DISTINCT FROM original."typeId"
     OR inventory.quantity::bigint <> original.quantity::bigint
     OR inventory."movementType" <> 'RETURNED_TO_OWNER' OR inventory."saleId" IS NOT NULL THEN
    RAISE EXCEPTION 'Supplier return needs an exact matching on-hand movement.';
  END IF;
  SELECT EXISTS (SELECT 1 FROM supplier_empties_events
    WHERE "reversesEntryId" = original.id) INTO event_reversed;
  SELECT EXISTS (SELECT 1 FROM empties_movements
    WHERE "reversesEntryId" = inventory.id) INTO inventory_reversed;
  IF event_reversed IS DISTINCT FROM inventory_reversed THEN
    RAISE EXCEPTION 'Correct the supplier event and its on-hand movement together.';
  END IF;
END;
$$;

CREATE FUNCTION fn_check_supplier_empties_event_pair()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_validate_supplier_empties_pair(COALESCE(NEW."reversesEntryId", NEW.id));
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_supplier_empties_event_pair
  AFTER INSERT ON supplier_empties_events DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_check_supplier_empties_event_pair();

CREATE FUNCTION fn_check_supplier_empties_inventory_pair()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."supplierEmptiesEventId" IS NOT NULL THEN
    PERFORM fn_validate_supplier_empties_pair(NEW."supplierEmptiesEventId");
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_supplier_empties_inventory_pair
  AFTER INSERT ON empties_movements DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_check_supplier_empties_inventory_pair();

CREATE FUNCTION fn_purchase_empties_new_document()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'VOIDED' THEN
    RAISE EXCEPTION 'A new purchase cannot start voided.';
  END IF;
  NEW."emptiesTrackingVersion" := 1;
  NEW."emptiesCreationTxid" := txid_current();
  NEW."emptiesReceiptTxid" := CASE WHEN NEW.status = 'RECEIVED' THEN txid_current() ELSE NULL END;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_purchase_empties_new_document
  BEFORE INSERT ON purchases
  FOR EACH ROW EXECUTE FUNCTION fn_purchase_empties_new_document();

CREATE FUNCTION fn_purchase_empties_status_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."emptiesTrackingVersion" IS DISTINCT FROM OLD."emptiesTrackingVersion"
     OR NEW."emptiesCreationTxid" IS DISTINCT FROM OLD."emptiesCreationTxid" THEN
    RAISE EXCEPTION 'Purchase empties tracking metadata cannot be changed.';
  END IF;
  IF OLD."emptiesTrackingVersion" = 1 AND OLD.status = 'DRAFT' AND NEW.status = 'RECEIVED' THEN
    NEW."emptiesReceiptTxid" := txid_current();
  ELSIF NEW."emptiesReceiptTxid" IS DISTINCT FROM OLD."emptiesReceiptTxid" THEN
    RAISE EXCEPTION 'Purchase empties tracking metadata cannot be changed.';
  END IF;
  IF OLD."emptiesTrackingVersion" IS NULL AND OLD.status = 'DRAFT'
     AND NEW.status = 'RECEIVED' THEN
    RAISE EXCEPTION 'This old draft must be recreated with the empties check.';
  END IF;
  IF OLD."emptiesTrackingVersion" = 1 THEN
    IF NEW.status = 'VOIDED' AND OLD.status <> 'VOIDED'
       AND OLD."emptiesReceiptTxid" = txid_current() THEN
      RAISE EXCEPTION 'A purchase cannot be received and voided in the same transaction.';
    END IF;
    IF OLD.status = 'VOIDED' AND NEW.status <> 'VOIDED' THEN
      RAISE EXCEPTION 'A voided purchase cannot be reopened.';
    END IF;
    IF OLD.status = 'RECEIVED' AND NEW.status NOT IN ('RECEIVED', 'VOIDED') THEN
      RAISE EXCEPTION 'A received purchase cannot return to draft.';
    END IF;
    IF NEW.status = 'VOIDED' AND OLD.status <> 'VOIDED' AND EXISTS (
      SELECT 1 FROM supplier_empties_events e
       WHERE e."purchaseId" = NEW.id AND e."eventType" = 'DEBT_SETTLEMENT'
         AND e."reversesEntryId" IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM supplier_empties_events reversal
            WHERE reversal."reversesEntryId" = e.id
         )
    ) THEN
      RAISE EXCEPTION 'Correct the linked empties settlements before voiding or editing this purchase.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_purchase_empties_status_guard
  BEFORE UPDATE ON purchases
  FOR EACH ROW EXECUTE FUNCTION fn_purchase_empties_status_guard();

CREATE FUNCTION fn_supplier_empties_obligation_origin()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  origin supplier_empties_events%ROWTYPE;
BEGIN
  SELECT * INTO origin FROM supplier_empties_events
   WHERE "obligationId" = NEW.id
     AND "eventType" IN ('OPENING_DEBT', 'PURCHASE_DEBT')
     AND "reversesEntryId" IS NULL;
  IF NOT FOUND OR origin."typeId" IS DISTINCT FROM NEW."typeId"
     OR origin."purchaseId" IS DISTINCT FROM NEW."purchaseId"
     OR (NEW."purchaseId" IS NULL AND origin."eventType" <> 'OPENING_DEBT')
     OR (NEW."purchaseId" IS NOT NULL AND origin."eventType" <> 'PURCHASE_DEBT') THEN
    RAISE EXCEPTION 'A supplier empties obligation needs exactly one matching debt origin.';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_supplier_empties_obligation_origin
  AFTER INSERT ON supplier_empties_obligations DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_supplier_empties_obligation_origin();

-- Config changes take the same product lock as receipt. This must also hold
-- when packaging rows are changed or deleted separately.
CREATE FUNCTION fn_purchase_empties_config_lock()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE product_id TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."productId" IS DISTINCT FROM OLD."productId" THEN
    RAISE EXCEPTION 'Move a purchase packaging configuration by removing and recreating it.';
  END IF;
  product_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."productId" ELSE NEW."productId" END;
  PERFORM 1 FROM products WHERE id = product_id FOR UPDATE;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_purchase_empties_product_config_lock
  BEFORE INSERT OR UPDATE OR DELETE ON purchase_empties_products
  FOR EACH ROW EXECUTE FUNCTION fn_purchase_empties_config_lock();
CREATE TRIGGER trg_purchase_empties_packaging_config_lock
  BEFORE INSERT OR UPDATE OR DELETE ON purchase_empties_packaging
  FOR EACH ROW EXECUTE FUNCTION fn_purchase_empties_config_lock();
CREATE TRIGGER trg_purchase_empties_product_config_no_truncate
  BEFORE TRUNCATE ON purchase_empties_products
  FOR EACH STATEMENT EXECUTE FUNCTION fn_raise_immutable();
CREATE TRIGGER trg_purchase_empties_packaging_config_no_truncate
  BEFORE TRUNCATE ON purchase_empties_packaging
  FOR EACH STATEMENT EXECUTE FUNCTION fn_raise_immutable();

CREATE FUNCTION fn_check_new_product_empties_classification()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM purchase_empties_products WHERE "productId" = NEW.id
  ) THEN
    RAISE EXCEPTION 'Classify this product in Purchase empties setup before saving it.';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_new_product_empties_classification
  AFTER INSERT ON products DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_check_new_product_empties_classification();

-- An existing received document may not acquire extra lines or snapshots in a
-- later transaction. Drafts may be assembled before they are received.
CREATE FUNCTION fn_purchase_empties_document_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  purchase_id TEXT;
  purchase purchases%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'purchase_lines' OR TG_TABLE_NAME = 'purchase_empties_checks' THEN
    purchase_id := NEW."purchaseId";
  ELSE
    SELECT "purchaseId" INTO purchase_id FROM purchase_lines WHERE id = NEW."purchaseLineId";
  END IF;
  SELECT * INTO purchase FROM purchases WHERE id = purchase_id FOR UPDATE;
  IF NOT FOUND OR purchase."emptiesTrackingVersion" IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Historical purchase documents cannot receive new empties or lines.';
  END IF;
  IF purchase.status = 'VOIDED'
     OR (purchase.status = 'RECEIVED' AND purchase."emptiesReceiptTxid" IS DISTINCT FROM txid_current()) THEN
    RAISE EXCEPTION 'A received purchase cannot receive new lines or empties checks.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_purchase_empties_line_insert
  BEFORE INSERT ON purchase_lines
  FOR EACH ROW EXECUTE FUNCTION fn_purchase_empties_document_insert();
CREATE TRIGGER trg_purchase_empties_requirement_insert
  BEFORE INSERT ON purchase_empties_requirements
  FOR EACH ROW EXECUTE FUNCTION fn_purchase_empties_document_insert();
CREATE TRIGGER trg_purchase_empties_line_snapshot_insert
  BEFORE INSERT ON purchase_empties_line_snapshots
  FOR EACH ROW EXECUTE FUNCTION fn_purchase_empties_document_insert();
CREATE TRIGGER trg_purchase_empties_check_insert
  BEFORE INSERT ON purchase_empties_checks
  FOR EACH ROW EXECUTE FUNCTION fn_purchase_empties_document_insert();

-- Validated once when the new document is received; historical snapshots do
-- not change if a product's configuration is later edited.
CREATE FUNCTION fn_validate_purchase_empties_configuration(purchase_id TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM products p
   WHERE p.id IN (SELECT "productId" FROM purchase_lines WHERE "purchaseId" = purchase_id)
   ORDER BY p.id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM purchase_lines WHERE "purchaseId" = purchase_id) THEN
    RAISE EXCEPTION 'A received purchase needs at least one line.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM purchase_lines l
    LEFT JOIN purchase_empties_products c ON c."productId" = l."productId"
    LEFT JOIN purchase_empties_line_snapshots s ON s."purchaseLineId" = l.id
    WHERE l."purchaseId" = purchase_id
      AND (c."productId" IS NULL OR s."purchaseLineId" IS NULL
           OR s.classification IS DISTINCT FROM c.classification)
  ) THEN
    RAISE EXCEPTION 'Every purchase line needs its matching empties classification snapshot.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM purchase_lines l
    LEFT JOIN purchase_empties_products c ON c."productId" = l."productId"
    WHERE l."purchaseId" = purchase_id
      AND (c."productId" IS NULL OR (
        c.classification = 'RETURNABLE' AND NOT EXISTS (
          SELECT 1 FROM purchase_empties_packaging p WHERE p."productId" = l."productId"
        )
      ))
  ) THEN
    RAISE EXCEPTION 'Set up purchase empties classification and packaging for every product.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM purchase_lines l
    JOIN purchase_empties_products c ON c."productId" = l."productId"
    JOIN purchase_empties_requirements r ON r."purchaseLineId" = l.id
    LEFT JOIN purchase_empties_packaging p
      ON p."productId" = l."productId" AND p.kind = r.kind AND p."typeId" = r."typeId"
    LEFT JOIN empties_types t ON t.id = p."typeId"
    LEFT JOIN empties_owners o ON o.id = t."ownerId"
    WHERE l."purchaseId" = purchase_id AND (
      c.classification <> 'RETURNABLE' OR p."productId" IS NULL OR NOT t."isActive" OR NOT o."isActive"
      OR r."countPerUnitSnapshot" IS DISTINCT FROM p."countPerUnit"
      OR r."countPerPackSnapshot" IS DISTINCT FROM p."countPerPack"
      OR (r.kind = 'BOTTLE' AND (
        r."manualCrateCount" OR r.quantity::bigint <> l."quantityUnits"::bigint * p."countPerUnit"
      ))
      OR (r.kind = 'CRATE' AND (
        r."manualCrateCount" IS DISTINCT FROM (l.unit = 'UNIT' OR l.quantity <> trunc(l.quantity))
        OR (NOT r."manualCrateCount" AND r.quantity::numeric <> l.quantity * p."countPerPack")
      ))
    )
  ) THEN
    RAISE EXCEPTION 'A purchase empties requirement does not match product packaging.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM purchase_lines l
    JOIN purchase_empties_products c ON c."productId" = l."productId"
    JOIN purchase_empties_packaging p ON p."productId" = l."productId"
    LEFT JOIN purchase_empties_requirements r
      ON r."purchaseLineId" = l.id AND r.kind = p.kind AND r."typeId" = p."typeId"
    WHERE l."purchaseId" = purchase_id AND c.classification = 'RETURNABLE'
      AND r."purchaseLineId" IS NULL
  ) THEN
    RAISE EXCEPTION 'A purchase line is missing a configured container requirement.';
  END IF;
END;
$$;

CREATE FUNCTION fn_validate_purchase_empties_receipt(purchase_id TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  purchase purchases%ROWTYPE;
BEGIN
  SELECT * INTO purchase FROM purchases WHERE id = purchase_id;
  IF NOT FOUND OR purchase."emptiesTrackingVersion" IS DISTINCT FROM 1 THEN
    RETURN;
  END IF;
  IF purchase.status = 'DRAFT' THEN
    IF EXISTS (SELECT 1 FROM purchase_empties_checks WHERE "purchaseId" = purchase_id)
       OR EXISTS (SELECT 1 FROM supplier_empties_events WHERE "purchaseId" = purchase_id)
       OR EXISTS (
         SELECT 1 FROM stock_movements sm JOIN purchase_lines l ON l.id = sm."purchaseLineId"
          WHERE l."purchaseId" = purchase_id
       ) THEN
      RAISE EXCEPTION 'A draft cannot commit purchase empties checks or events.';
    END IF;
    RETURN;
  END IF;
  IF purchase.status = 'VOIDED' THEN
    IF EXISTS (
      SELECT 1 FROM supplier_empties_events e
       WHERE e."purchaseId" = purchase_id AND e."reversesEntryId" IS NULL
         AND NOT EXISTS (SELECT 1 FROM supplier_empties_events x WHERE x."reversesEntryId" = e.id)
    ) THEN
      RAISE EXCEPTION 'A voided purchase must have all its empties events reversed.';
    END IF;
    IF EXISTS (
      SELECT 1 FROM stock_movements sm JOIN purchase_lines l ON l.id = sm."purchaseLineId"
       WHERE l."purchaseId" = purchase_id AND sm."reversesEntryId" IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM stock_movements reversal WHERE reversal."reversesEntryId" = sm.id
         )
    ) THEN
      RAISE EXCEPTION 'A voided purchase must have its stock movements reversed.';
    END IF;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM purchase_lines l
    LEFT JOIN purchase_empties_line_snapshots s ON s."purchaseLineId" = l.id
    WHERE l."purchaseId" = purchase_id AND (
      s."purchaseLineId" IS NULL
      OR (s.classification = 'RETURNABLE' AND NOT EXISTS (
        SELECT 1 FROM purchase_empties_requirements r WHERE r."purchaseLineId" = l.id
      ))
      OR (s.classification = 'NON_RETURNABLE' AND EXISTS (
        SELECT 1 FROM purchase_empties_requirements r WHERE r."purchaseLineId" = l.id
      ))
    )
  ) THEN
    RAISE EXCEPTION 'A purchase line is missing its empties classification or requirements.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM purchase_lines l
    LEFT JOIN stock_movements sm
      ON sm."purchaseLineId" = l.id AND sm."reversesEntryId" IS NULL
    WHERE l."purchaseId" = purchase_id AND (
      sm.id IS NULL OR sm.type <> 'PURCHASE' OR sm."productId" <> l."productId"
      OR sm."quantityUnits" <> l."quantityUnits" OR sm."unitCostKobo" <> l."unitCostKobo"
      OR EXISTS (SELECT 1 FROM stock_movements rev WHERE rev."reversesEntryId" = sm.id)
    )
  ) THEN
    RAISE EXCEPTION 'Each received purchase line needs its matching unreversed stock movement.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM supplier_empties_events e
     WHERE e."purchaseId" = purchase_id
       AND e."eventType" IN ('RETURNED_FOR_PURCHASE', 'SUPPLIED_FREE', 'PURCHASE_DEBT')
       AND e."reversesEntryId" IS NULL
       AND EXISTS (SELECT 1 FROM supplier_empties_events x WHERE x."reversesEntryId" = e.id)
  ) THEN
    RAISE EXCEPTION 'Purchase empties events can only be reversed when the purchase is voided.';
  END IF;

  -- Every positive requirement has one check, and there are no surplus checks.
  IF EXISTS (
    WITH required AS (
      SELECT r."typeId", SUM(r.quantity)::bigint AS quantity
        FROM purchase_empties_requirements r
        JOIN purchase_lines l ON l.id = r."purchaseLineId"
       WHERE l."purchaseId" = purchase_id
       GROUP BY r."typeId" HAVING SUM(r.quantity) > 0
    )
    SELECT 1 FROM required r FULL JOIN (
      SELECT * FROM purchase_empties_checks WHERE "purchaseId" = purchase_id
    ) c ON c."typeId" = r."typeId"
    WHERE r."typeId" IS NULL OR c."typeId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Purchase empties checks must cover each required container type.';
  END IF;

  -- A type's return is the smaller of the required and locked available count.
  -- The remaining shortage may be split between free supply and debt.
  IF EXISTS (
    WITH required AS (
      SELECT r."typeId", SUM(r.quantity)::bigint AS quantity
        FROM purchase_empties_requirements r
        JOIN purchase_lines l ON l.id = r."purchaseLineId"
       WHERE l."purchaseId" = purchase_id
       GROUP BY r."typeId" HAVING SUM(r.quantity) > 0
    ), events AS (
      SELECT e."typeId",
             COALESCE(SUM(-e.quantity::bigint) FILTER (WHERE e."eventType" = 'RETURNED_FOR_PURCHASE'), 0)::bigint AS returned,
             COALESCE(SUM(e.quantity) FILTER (WHERE e."eventType" = 'SUPPLIED_FREE'), 0)::bigint AS gifted,
             COALESCE(SUM(e.quantity) FILTER (WHERE e."eventType" = 'PURCHASE_DEBT'), 0)::bigint AS owed
        FROM supplier_empties_events e
       WHERE e."purchaseId" = purchase_id AND e."reversesEntryId" IS NULL
         AND e."eventType" IN ('RETURNED_FOR_PURCHASE', 'SUPPLIED_FREE', 'PURCHASE_DEBT')
       GROUP BY e."typeId"
    )
    SELECT 1 FROM required r
    JOIN purchase_empties_checks c ON c."purchaseId" = purchase_id AND c."typeId" = r."typeId"
    LEFT JOIN events e ON e."typeId" = r."typeId"
    WHERE COALESCE(e.returned, 0) <> LEAST(r.quantity, c."availableQuantity"::bigint)
       OR COALESCE(e.gifted, 0) + COALESCE(e.owed, 0) <> r.quantity - LEAST(r.quantity, c."availableQuantity"::bigint)
  ) OR EXISTS (
    SELECT 1 FROM supplier_empties_events e
     WHERE e."purchaseId" = purchase_id AND e."reversesEntryId" IS NULL
       AND e."eventType" IN ('RETURNED_FOR_PURCHASE', 'SUPPLIED_FREE', 'PURCHASE_DEBT')
       AND NOT EXISTS (
         SELECT 1 FROM purchase_empties_requirements r
         JOIN purchase_lines l ON l.id = r."purchaseLineId"
         WHERE l."purchaseId" = purchase_id AND r."typeId" = e."typeId" AND r.quantity > 0
       )
  ) THEN
    RAISE EXCEPTION 'The purchase has an unresolved or incorrect empties shortage.';
  END IF;
END;
$$;

CREATE FUNCTION fn_check_purchase_empties_document()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."emptiesTrackingVersion" = 1 AND NEW.status = 'RECEIVED'
     AND (TG_OP = 'INSERT' OR OLD.status = 'DRAFT') THEN
    PERFORM fn_validate_purchase_empties_configuration(NEW.id);
    IF EXISTS (
      SELECT 1 FROM purchase_empties_checks c
       WHERE c."purchaseId" = NEW.id AND c."capturedTxid" <> txid_current()
    ) THEN
      RAISE EXCEPTION 'Purchase empties availability must be checked in the receipt transaction.';
    END IF;
  END IF;
  PERFORM fn_validate_purchase_empties_receipt(NEW.id);
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_purchase_empties_document_complete
  AFTER INSERT OR UPDATE ON purchases DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_check_purchase_empties_document();

CREATE FUNCTION fn_check_purchase_empties_line()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE purchase_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'purchase_lines' OR TG_TABLE_NAME = 'purchase_empties_checks' THEN
    purchase_id := NEW."purchaseId";
  ELSE
    SELECT "purchaseId" INTO purchase_id FROM purchase_lines WHERE id = NEW."purchaseLineId";
  END IF;
  PERFORM fn_validate_purchase_empties_receipt(purchase_id);
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_purchase_empties_line_complete
  AFTER INSERT ON purchase_lines DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_check_purchase_empties_line();
CREATE CONSTRAINT TRIGGER trg_purchase_empties_requirement_complete
  AFTER INSERT ON purchase_empties_requirements DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_check_purchase_empties_line();
CREATE CONSTRAINT TRIGGER trg_purchase_empties_line_snapshot_complete
  AFTER INSERT ON purchase_empties_line_snapshots DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_check_purchase_empties_line();
CREATE CONSTRAINT TRIGGER trg_purchase_empties_check_complete
  AFTER INSERT ON purchase_empties_checks DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_check_purchase_empties_line();

CREATE FUNCTION fn_check_supplier_empties_purchase()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."purchaseId" IS NOT NULL THEN
    PERFORM fn_validate_purchase_empties_receipt(NEW."purchaseId");
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_supplier_empties_purchase_complete
  AFTER INSERT ON supplier_empties_events DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_check_supplier_empties_purchase();

CREATE FUNCTION fn_purchase_empties_stock_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tracking_version INTEGER;
BEGIN
  IF NEW."purchaseLineId" IS NULL THEN RETURN NEW; END IF;
  SELECT p."emptiesTrackingVersion" INTO tracking_version
    FROM purchase_lines l JOIN purchases p ON p.id = l."purchaseId"
   WHERE l.id = NEW."purchaseLineId" FOR UPDATE OF p;
  IF tracking_version IS NULL AND NEW."reversesEntryId" IS NULL THEN
    RAISE EXCEPTION 'An old purchase cannot receive a new original stock movement.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_purchase_empties_stock_insert
  BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION fn_purchase_empties_stock_insert();

CREATE FUNCTION fn_check_purchase_empties_stock()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE purchase_id TEXT;
BEGIN
  IF NEW."purchaseLineId" IS NOT NULL THEN
    SELECT "purchaseId" INTO purchase_id FROM purchase_lines WHERE id = NEW."purchaseLineId";
    PERFORM fn_validate_purchase_empties_receipt(purchase_id);
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_purchase_empties_stock_complete
  AFTER INSERT ON stock_movements DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_check_purchase_empties_stock();

-- Review and TEST rehearsal must prove the deferred completeness, reversal,
-- purchase/settlement lock ordering and old-API rejection behavior.
