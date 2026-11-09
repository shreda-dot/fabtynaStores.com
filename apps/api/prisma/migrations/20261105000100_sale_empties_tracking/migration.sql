-- Sales silently record the containers assumed returned, and customer TAKEN
-- movements record inventory leaving the shop. Every count remains immutable.

ALTER TABLE empties_movements
  ADD COLUMN "saleId" TEXT,
  ADD CONSTRAINT fk_empties_movements_sale
    FOREIGN KEY ("saleId") REFERENCES sales (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT ck_empties_movements_sale_source
    CHECK ("saleId" IS NULL OR "movementType" = 'RECEIVED');

ALTER TABLE empties_movements
  DROP CONSTRAINT ck_empties_movements_sign,
  ADD CONSTRAINT ck_empties_movements_sign CHECK (
    "reversesEntryId" IS NOT NULL
    OR ("movementType" IN ('OPENING', 'RECEIVED') AND quantity > 0)
    OR ("movementType" IN ('RETURNED_TO_OWNER', 'ISSUED_TO_CUSTOMER') AND quantity < 0)
    OR ("movementType" = 'ADJUSTMENT' AND quantity <> 0)
  );

CREATE UNIQUE INDEX ux_empties_movement_sale_type_active
  ON empties_movements ("saleId", "typeId")
  WHERE "saleId" IS NOT NULL AND "reversesEntryId" IS NULL;

CREATE INDEX empties_movements_sale_type_idx
  ON empties_movements ("saleId", "typeId");

CREATE UNIQUE INDEX empties_product_owners_product_owner_key
  ON empties_product_owners ("productId", "ownerId");

CREATE UNIQUE INDEX empties_types_owner_id_kind_key
  ON empties_types ("ownerId", id, kind);

CREATE TABLE empties_product_packaging (
  "productId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "typeId" TEXT NOT NULL,
  kind "EmptiesKind" NOT NULL,
  "retailQuantityPerUnit" INTEGER NOT NULL,
  "wholesaleQuantityPerPack" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT empties_product_packaging_pkey PRIMARY KEY ("productId", kind),
  CONSTRAINT fk_empties_product_packaging_product_owner
    FOREIGN KEY ("productId", "ownerId")
    REFERENCES empties_product_owners ("productId", "ownerId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_empties_product_packaging_type
    FOREIGN KEY ("ownerId", "typeId", kind)
    REFERENCES empties_types ("ownerId", id, kind)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_empties_product_packaging_counts_nonnegative
    CHECK ("retailQuantityPerUnit" >= 0 AND "wholesaleQuantityPerPack" >= 0),
  CONSTRAINT ck_empties_product_packaging_counts_nonzero
    CHECK ("retailQuantityPerUnit" > 0 OR "wholesaleQuantityPerPack" > 0)
);

CREATE INDEX empties_product_packaging_type_idx
  ON empties_product_packaging ("typeId", "productId");

ALTER TABLE empties_customer_movements
  DROP CONSTRAINT ck_empties_customer_movements_return_link,
  ADD CONSTRAINT ck_empties_customer_movements_inventory_link CHECK (
    ("movementType" = 'TAKEN')
    OR ("movementType" = 'RETURNED' AND "emptiesMovementId" IS NOT NULL)
    OR ("movementType" NOT IN ('TAKEN', 'RETURNED') AND "emptiesMovementId" IS NULL)
  );

DROP INDEX ux_empties_customer_movement_received_link;
CREATE UNIQUE INDEX ux_empties_customer_movement_inventory_link
  ON empties_customer_movements ("emptiesMovementId")
  WHERE "movementType" IN ('TAKEN', 'RETURNED')
    AND "reversesEntryId" IS NULL
    AND "emptiesMovementId" IS NOT NULL;

DROP TRIGGER trg_empties_customer_movement_return_link ON empties_customer_movements;

CREATE FUNCTION fn_check_empties_customer_inventory_link()
RETURNS trigger AS $$
DECLARE
  linked_type_id TEXT;
  linked_movement_type "EmptiesMovementType";
  linked_quantity INTEGER;
  expected_movement_type "EmptiesMovementType";
BEGIN
  IF NEW."emptiesMovementId" IS NULL THEN
    IF NEW."movementType" = 'TAKEN' AND NOT (
      NEW."reversesEntryId" IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM empties_customer_movements old
         WHERE old.id = NEW."reversesEntryId"
           AND old."movementType" = 'TAKEN'
           AND old."emptiesMovementId" IS NULL
           AND old."reversesEntryId" IS NULL
      )
    ) THEN
      RAISE EXCEPTION 'A new customer TAKEN movement must link to an on-hand issue.';
    END IF;
    RETURN NEW;
  END IF;

  expected_movement_type :=
    CASE NEW."movementType"
      WHEN 'TAKEN' THEN 'ISSUED_TO_CUSTOMER'::"EmptiesMovementType"
      WHEN 'RETURNED' THEN 'RECEIVED'::"EmptiesMovementType"
      ELSE NULL
    END;

  SELECT "typeId", "movementType", quantity
    INTO linked_type_id, linked_movement_type, linked_quantity
    FROM empties_movements
   WHERE id = NEW."emptiesMovementId";

  IF expected_movement_type IS NULL
     OR NOT FOUND
     OR linked_movement_type <> expected_movement_type
     OR linked_type_id IS DISTINCT FROM NEW."typeId"
     OR (NEW."reversesEntryId" IS NULL AND linked_quantity::bigint <> -NEW.quantity::bigint)
     OR (NEW."reversesEntryId" IS NOT NULL AND linked_quantity::bigint <> NEW.quantity::bigint) THEN
    RAISE EXCEPTION
      'A customer TAKEN or RETURNED movement must link to a matching on-hand empties movement.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_empties_customer_movement_inventory_link
  BEFORE INSERT ON empties_customer_movements
  FOR EACH ROW EXECUTE FUNCTION fn_check_empties_customer_inventory_link();
