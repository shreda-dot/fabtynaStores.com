CREATE TABLE empties_approved_capacities (
  capacity INTEGER NOT NULL,
  CONSTRAINT empties_approved_capacities_pkey PRIMARY KEY (capacity),
  CONSTRAINT ck_empties_approved_capacities_size CHECK (capacity > 1)
);

INSERT INTO empties_approved_capacities (capacity)
VALUES (12), (20), (24);

CREATE TRIGGER trg_empties_approved_capacities_immutable
  BEFORE UPDATE OR DELETE ON empties_approved_capacities
  FOR EACH ROW EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_empties_approved_capacities_no_truncate
  BEFORE TRUNCATE ON empties_approved_capacities
  EXECUTE FUNCTION fn_raise_immutable();

ALTER TABLE empties_types
  ADD COLUMN capacity INTEGER,
  ADD CONSTRAINT fk_empties_types_capacity
    FOREIGN KEY (capacity) REFERENCES empties_approved_capacities (capacity)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT ck_empties_types_capacity_bottle
    CHECK (capacity IS NULL OR kind = 'BOTTLE');

CREATE UNIQUE INDEX ux_empties_types_owner_kind_capacity
  ON empties_types ("ownerId", kind, capacity)
  WHERE capacity IS NOT NULL;

CREATE FUNCTION fn_empties_type_capacity_immutable()
RETURNS trigger AS $$
BEGIN
  IF NEW.capacity IS DISTINCT FROM OLD.capacity THEN
    RAISE EXCEPTION 'empties_types.capacity is immutable once created.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_empties_type_capacity_immutable
  BEFORE UPDATE ON empties_types
  FOR EACH ROW EXECUTE FUNCTION fn_empties_type_capacity_immutable();
