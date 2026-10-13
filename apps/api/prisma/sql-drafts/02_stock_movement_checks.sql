-- =====================================================================
-- DRAFT — Stock movement source and sign CHECK constraints
-- =====================================================================
-- source rule: exactly one source foreign key must be non-null.
--   (purchaseLineId, saleLineId, transferLegId, adjustmentLineId, returnLineId)
-- sign rule by type:
--   PURCHASE    -> quantityUnits > 0  (stock in)
--   SALE        -> quantityUnits < 0  (stock out)
--   RETURN      -> quantityUnits > 0  (restocked; non-restock returns use a
--                                       negative ADJUSTMENT movement instead)
--   ADJUSTMENT  -> quantityUnits <> 0 (either sign)
--   TRANSFER    -> quantityUnits <> 0 (sign must match the owning leg's
--                                       direction; enforced by the trigger in
--                                       04_immutability_triggers.sql because a
--                                       CHECK cannot read the related leg row)
-- cost rule: unitCostKobo >= 0

ALTER TABLE stock_movements
  ADD CONSTRAINT ck_stock_movement_single_source
  CHECK (
    (
      (CASE WHEN "purchaseLineId"   IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN "saleLineId"       IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN "transferLegId"    IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN "adjustmentLineId" IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN "returnLineId"     IS NOT NULL THEN 1 ELSE 0 END)
    ) = 1
  );

ALTER TABLE stock_movements
  ADD CONSTRAINT ck_stock_movement_quantity_sign
  CHECK (
    (type = 'PURCHASE'   AND "quantityUnits" > 0)
    OR (type = 'SALE'      AND "quantityUnits" < 0)
    OR (type = 'RETURN'    AND "quantityUnits" > 0)
    OR (type = 'ADJUSTMENT' AND "quantityUnits" <> 0)
    OR (type = 'TRANSFER'   AND "quantityUnits" <> 0)
  );

ALTER TABLE stock_movements
  ADD CONSTRAINT ck_stock_movement_unit_cost_nonnegative
  CHECK ("unitCostKobo" >= 0);
