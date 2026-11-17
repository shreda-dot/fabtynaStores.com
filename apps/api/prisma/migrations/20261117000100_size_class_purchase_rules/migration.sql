ALTER TABLE purchase_empties_packaging
  ADD COLUMN "cratesPerPack" INTEGER,
  DROP CONSTRAINT ck_purchase_empties_packaging_counts,
  ADD CONSTRAINT ck_purchase_empties_packaging_counts CHECK (
    (kind = 'BOTTLE' AND "countPerUnit" IS NOT NULL AND "countPerUnit" > 0
      AND "countPerPack" IS NULL
      AND ("cratesPerPack" IS NULL OR "cratesPerPack" > 0))
    OR (kind = 'CRATE' AND "countPerPack" IS NOT NULL AND "countPerPack" > 0
      AND "countPerUnit" IS NULL AND "cratesPerPack" IS NULL)
  );

ALTER TABLE purchase_empties_requirements
  ADD COLUMN "crateCountSnapshot" INTEGER,
  ADD COLUMN "cratesPerPackSnapshot" INTEGER,
  DROP CONSTRAINT ck_purchase_empties_requirement_rates,
  ADD CONSTRAINT ck_purchase_empties_requirement_rates CHECK (
    (kind = 'BOTTLE' AND "countPerUnitSnapshot" IS NOT NULL AND "countPerUnitSnapshot" > 0
      AND "countPerPackSnapshot" IS NULL
      AND ("crateCountSnapshot" IS NULL OR "crateCountSnapshot" >= 0)
      AND ("cratesPerPackSnapshot" IS NULL OR "cratesPerPackSnapshot" > 0)
      AND (("crateCountSnapshot" IS NULL AND "cratesPerPackSnapshot" IS NULL AND NOT "manualCrateCount")
        OR ("crateCountSnapshot" IS NOT NULL AND "manualCrateCount")))
    OR (kind = 'CRATE' AND "countPerPackSnapshot" IS NOT NULL AND "countPerPackSnapshot" > 0
      AND "countPerUnitSnapshot" IS NULL AND "crateCountSnapshot" IS NULL
      AND "cratesPerPackSnapshot" IS NULL)
  );

CREATE FUNCTION fn_size_class_supplier_event_crate_units()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  crate_capacity INTEGER;
BEGIN
  SELECT capacity INTO crate_capacity FROM empties_types WHERE id = NEW."typeId";
  IF crate_capacity IS NOT NULL AND NEW.quantity::bigint % crate_capacity::bigint <> 0 THEN
    RAISE EXCEPTION 'Supplier empties events for a size class must be whole crates.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_size_class_supplier_event_crate_units
  BEFORE INSERT ON supplier_empties_events
  FOR EACH ROW EXECUTE FUNCTION fn_size_class_supplier_event_crate_units();

CREATE OR REPLACE FUNCTION fn_validate_purchase_empties_configuration(purchase_id TEXT)
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
      OR r."cratesPerPackSnapshot" IS DISTINCT FROM p."cratesPerPack"
      OR (r.kind = 'BOTTLE' AND (
        (t.capacity IS NULL AND (
          r."manualCrateCount" OR r."crateCountSnapshot" IS NOT NULL
          OR r."cratesPerPackSnapshot" IS NOT NULL
          OR r.quantity::bigint <> l."quantityUnits"::bigint * p."countPerUnit"
        ))
        OR (t.capacity IS NOT NULL AND (
          p."countPerUnit" <> 1 OR NOT r."manualCrateCount"
          OR r."crateCountSnapshot" IS NULL
          OR r.quantity::bigint <> r."crateCountSnapshot"::bigint * t.capacity::bigint
        ))
      ))
      OR (r.kind = 'CRATE' AND (
        t.capacity IS NOT NULL
        OR r."manualCrateCount" IS DISTINCT FROM (l.unit = 'UNIT' OR l.quantity <> trunc(l.quantity))
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

CREATE OR REPLACE FUNCTION fn_validate_purchase_empties_receipt(purchase_id TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  purchase purchases%ROWTYPE;
BEGIN
  SELECT * INTO purchase FROM purchases WHERE id = purchase_id;
  IF NOT FOUND OR purchase."emptiesTrackingVersion" IS DISTINCT FROM 1 THEN RETURN; END IF;
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
    ) THEN RAISE EXCEPTION 'A voided purchase must have all its empties events reversed.'; END IF;
    IF EXISTS (
      SELECT 1 FROM stock_movements sm JOIN purchase_lines l ON l.id = sm."purchaseLineId"
       WHERE l."purchaseId" = purchase_id AND sm."reversesEntryId" IS NULL
         AND NOT EXISTS (SELECT 1 FROM stock_movements r WHERE r."reversesEntryId" = sm.id)
    ) THEN RAISE EXCEPTION 'A voided purchase must have its stock movements reversed.'; END IF;
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
  ) THEN RAISE EXCEPTION 'A purchase line is missing its empties classification or requirements.'; END IF;
  IF EXISTS (
    SELECT 1 FROM purchase_lines l
    LEFT JOIN stock_movements sm ON sm."purchaseLineId" = l.id AND sm."reversesEntryId" IS NULL
    WHERE l."purchaseId" = purchase_id AND (
      sm.id IS NULL OR sm.type <> 'PURCHASE' OR sm."productId" <> l."productId"
      OR sm."quantityUnits" <> l."quantityUnits" OR sm."unitCostKobo" <> l."unitCostKobo"
      OR EXISTS (SELECT 1 FROM stock_movements rev WHERE rev."reversesEntryId" = sm.id)
    )
  ) THEN RAISE EXCEPTION 'Each received purchase line needs its matching unreversed stock movement.'; END IF;
  IF EXISTS (
    SELECT 1 FROM supplier_empties_events e
     WHERE e."purchaseId" = purchase_id
       AND e."eventType" IN ('RETURNED_FOR_PURCHASE', 'SUPPLIED_FREE', 'PURCHASE_DEBT')
       AND e."reversesEntryId" IS NULL
       AND EXISTS (SELECT 1 FROM supplier_empties_events x WHERE x."reversesEntryId" = e.id)
  ) THEN RAISE EXCEPTION 'Purchase empties events can only be reversed when the purchase is voided.'; END IF;
  IF EXISTS (
    WITH required AS (
      SELECT r."typeId", SUM(r.quantity)::bigint AS quantity
        FROM purchase_empties_requirements r JOIN purchase_lines l ON l.id = r."purchaseLineId"
       WHERE l."purchaseId" = purchase_id GROUP BY r."typeId" HAVING SUM(r.quantity) > 0
    )
    SELECT 1 FROM required r FULL JOIN (
      SELECT * FROM purchase_empties_checks WHERE "purchaseId" = purchase_id
    ) c ON c."typeId" = r."typeId"
    WHERE r."typeId" IS NULL OR c."typeId" IS NULL
  ) THEN RAISE EXCEPTION 'Purchase empties checks must cover each required container type.'; END IF;
  IF EXISTS (
    WITH required AS (
      SELECT r."typeId", SUM(r.quantity)::bigint AS quantity
        FROM purchase_empties_requirements r JOIN purchase_lines l ON l.id = r."purchaseLineId"
       WHERE l."purchaseId" = purchase_id GROUP BY r."typeId" HAVING SUM(r.quantity) > 0
    ), events AS (
      SELECT e."typeId",
             COALESCE(SUM(-e.quantity::bigint) FILTER (WHERE e."eventType" = 'RETURNED_FOR_PURCHASE'), 0)::bigint AS returned,
             COALESCE(SUM(e.quantity) FILTER (WHERE e."eventType" = 'SUPPLIED_FREE'), 0)::bigint AS gifted,
             COALESCE(SUM(e.quantity) FILTER (WHERE e."eventType" = 'PURCHASE_DEBT'), 0)::bigint AS owed
        FROM supplier_empties_events e
       WHERE e."purchaseId" = purchase_id AND e."reversesEntryId" IS NULL
         AND e."eventType" IN ('RETURNED_FOR_PURCHASE', 'SUPPLIED_FREE', 'PURCHASE_DEBT')
       GROUP BY e."typeId"
    ), expected AS (
      SELECT r."typeId", r.quantity,
             CASE WHEN t.capacity IS NULL
               THEN LEAST(r.quantity, c."availableQuantity"::bigint)
               ELSE LEAST(r.quantity, (c."availableQuantity"::bigint / t.capacity) * t.capacity)
             END AS returned
        FROM required r
        JOIN purchase_empties_checks c ON c."purchaseId" = purchase_id AND c."typeId" = r."typeId"
        JOIN empties_types t ON t.id = r."typeId"
    )
    SELECT 1 FROM expected x LEFT JOIN events e ON e."typeId" = x."typeId"
     WHERE COALESCE(e.returned, 0) <> x.returned
        OR COALESCE(e.gifted, 0) + COALESCE(e.owed, 0) <> x.quantity - x.returned
  ) OR EXISTS (
    SELECT 1 FROM supplier_empties_events e
     WHERE e."purchaseId" = purchase_id AND e."reversesEntryId" IS NULL
       AND e."eventType" IN ('RETURNED_FOR_PURCHASE', 'SUPPLIED_FREE', 'PURCHASE_DEBT')
       AND NOT EXISTS (
         SELECT 1 FROM purchase_empties_requirements r JOIN purchase_lines l ON l.id = r."purchaseLineId"
          WHERE l."purchaseId" = purchase_id AND r."typeId" = e."typeId" AND r.quantity > 0
       )
  ) THEN RAISE EXCEPTION 'The purchase has an unresolved or incorrect empties shortage.'; END IF;
END;
$$;
