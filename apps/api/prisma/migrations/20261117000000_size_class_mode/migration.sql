CREATE TABLE empties_size_class_mode (
  id INTEGER NOT NULL DEFAULT 1,
  phase TEXT NOT NULL DEFAULT 'LEGACY',
  CONSTRAINT empties_size_class_mode_pkey PRIMARY KEY (id),
  CONSTRAINT ck_empties_size_class_mode_singleton CHECK (id = 1),
  CONSTRAINT ck_empties_size_class_mode_phase
    CHECK (phase IN ('LEGACY', 'RECOUNT_PENDING', 'READY'))
);

INSERT INTO empties_size_class_mode (id, phase) VALUES (1, 'LEGACY');

CREATE TRIGGER trg_empties_size_class_mode_no_delete
  BEFORE DELETE ON empties_size_class_mode
  FOR EACH ROW EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_empties_size_class_mode_no_truncate
  BEFORE TRUNCATE ON empties_size_class_mode
  FOR EACH STATEMENT EXECUTE FUNCTION fn_raise_immutable();

CREATE SEQUENCE empties_size_class_order_seq AS BIGINT;

ALTER TABLE purchase_empties_packaging
  ADD COLUMN "confirmationOrder" BIGINT NOT NULL
    DEFAULT nextval('empties_size_class_order_seq');

CREATE TABLE empties_size_class_sales (
  "saleId" TEXT NOT NULL,
  "recordedOrder" BIGINT NOT NULL DEFAULT nextval('empties_size_class_order_seq'),
  CONSTRAINT empties_size_class_sales_pkey PRIMARY KEY ("saleId"),
  CONSTRAINT fk_empties_size_class_sales_sale FOREIGN KEY ("saleId")
    REFERENCES sales(id) ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE TRIGGER trg_empties_size_class_sales_immutable
  BEFORE UPDATE OR DELETE ON empties_size_class_sales
  FOR EACH ROW EXECUTE FUNCTION fn_raise_immutable();
CREATE TRIGGER trg_empties_size_class_sales_no_truncate
  BEFORE TRUNCATE ON empties_size_class_sales
  FOR EACH STATEMENT EXECUTE FUNCTION fn_raise_immutable();

CREATE FUNCTION fn_size_class_sale_order()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM products p
   WHERE p.id IN (SELECT "productId" FROM sale_lines WHERE "saleId" = NEW."saleId")
   ORDER BY p.id FOR UPDATE;
  NEW."recordedOrder" := nextval('empties_size_class_order_seq');
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_size_class_sale_order
  BEFORE INSERT ON empties_size_class_sales
  FOR EACH ROW EXECUTE FUNCTION fn_size_class_sale_order();

CREATE FUNCTION fn_size_class_mapping_has_live_history(
  product_id TEXT, type_id TEXT, confirmation_order BIGINT
)
RETURNS BOOLEAN LANGUAGE sql AS $$
  SELECT EXISTS (
    SELECT 1
      FROM sale_lines l
      JOIN sales s ON s.id = l."saleId"
      JOIN empties_size_class_sales marker ON marker."saleId" = s.id
      JOIN empties_movements m ON m."saleId" = s.id
     WHERE l."productId" = product_id AND s.status = 'COMPLETED'
       AND m."typeId" = type_id AND m."reversesEntryId" IS NULL
       AND marker."recordedOrder" > confirmation_order
  ) OR EXISTS (
    SELECT 1
      FROM purchase_lines l
      JOIN purchases p ON p.id = l."purchaseId"
      JOIN purchase_empties_requirements r ON r."purchaseLineId" = l.id
     WHERE l."productId" = product_id AND p.status = 'RECEIVED'
       AND r."typeId" = type_id
  );
$$;

CREATE FUNCTION fn_size_class_mapping_freeze()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_mapping purchase_empties_packaging%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."confirmationOrder" := nextval('empties_size_class_order_seq');
    RETURN NEW;
  END IF;
  PERFORM 1 FROM products WHERE id = OLD."productId" FOR UPDATE;
  IF TG_TABLE_NAME = 'purchase_empties_packaging' THEN
    IF TG_OP = 'UPDATE' AND NEW."confirmationOrder" IS DISTINCT FROM OLD."confirmationOrder" THEN
      RAISE EXCEPTION 'A packaging confirmation order cannot be changed.';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
    old_mapping := OLD;
  ELSE
    IF TG_OP = 'UPDATE' AND NEW.classification IS NOT DISTINCT FROM OLD.classification THEN
      RETURN NEW;
    END IF;
    SELECT p.* INTO old_mapping
      FROM purchase_empties_packaging p
      JOIN empties_types t ON t.id = p."typeId"
     WHERE p."productId" = OLD."productId" AND t.capacity IS NOT NULL;
  END IF;

  IF old_mapping."productId" IS NOT NULL
     AND EXISTS (SELECT 1 FROM empties_types t
                  WHERE t.id = old_mapping."typeId" AND t.capacity IS NOT NULL)
     AND fn_size_class_mapping_has_live_history(
       old_mapping."productId", old_mapping."typeId", old_mapping."confirmationOrder"
     ) THEN
    RAISE EXCEPTION 'A confirmed size cannot change while affected sales or purchases remain live.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_size_class_packaging_freeze
  BEFORE INSERT OR UPDATE OR DELETE ON purchase_empties_packaging
  FOR EACH ROW EXECUTE FUNCTION fn_size_class_mapping_freeze();
CREATE TRIGGER trg_size_class_classification_freeze
  BEFORE UPDATE OR DELETE ON purchase_empties_products
  FOR EACH ROW EXECUTE FUNCTION fn_size_class_mapping_freeze();
