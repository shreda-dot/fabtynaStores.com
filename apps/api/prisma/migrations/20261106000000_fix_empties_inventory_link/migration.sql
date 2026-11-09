-- Use a new function rather than changing the applied trigger function.
-- "old" is a PL/pgSQL trigger record and cannot also be a table alias.
CREATE FUNCTION fn_check_empties_customer_inventory_link_v2()
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
        SELECT 1 FROM empties_customer_movements original
         WHERE original.id = NEW."reversesEntryId"
           AND original."movementType" = 'TAKEN'
           AND original."emptiesMovementId" IS NULL
           AND original."reversesEntryId" IS NULL
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

DROP TRIGGER trg_empties_customer_movement_inventory_link ON empties_customer_movements;
CREATE TRIGGER trg_empties_customer_movement_inventory_link
  BEFORE INSERT ON empties_customer_movements
  FOR EACH ROW EXECUTE FUNCTION fn_check_empties_customer_inventory_link_v2();
