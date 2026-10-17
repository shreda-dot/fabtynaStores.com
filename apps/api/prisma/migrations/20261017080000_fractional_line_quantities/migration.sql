-- =====================================================================
-- Fractional line quantities (wholesale part-packs)
-- =====================================================================
-- `sale_lines.quantity` / `purchase_lines.quantity` hold the quantity in the
-- unit the operator typed (`UNIT` or `PACK`); `quantityUnits` remains the
-- authoritative count of base units and is still an INTEGER.
--
-- The sales domain already accepts a fractional pack quantity so a wholesale
-- customer can buy half a crate (`recordSale` computes the line total with
-- exact scaled-integer arithmetic and only accepts a fraction that resolves to
-- a whole number of units), and both Zod sale DTOs already use
-- `z.number().positive()`. The column was still INTEGER, so the database could
-- not store what the domain and the API accept. This migration closes that
-- gap: both columns become NUMERIC(12, 4), i.e. up to eight integer digits and
-- four decimal places — enough for 1/2, 1/4 and 1/8 of a pack.
--
-- No CHECK constraint is added or changed. The existing
-- `ck_sale_lines_quantity_positive` / `ck_sale_lines_units_consistent`
-- (migration `20261017000500_value_checks`) already express the contract —
-- `quantity > 0` and, for PACK lines,
-- `quantityUnits = quantity * unitsPerPackSnapshot` — and they keep doing so
-- for a NUMERIC quantity: `0.5 * 24 = 12.0000`, which compares equal to the
-- INTEGER `quantityUnits`. `ALTER COLUMN ... TYPE` re-validates every CHECK on
-- the table, so any row that cannot satisfy the rule aborts the migration.
--
-- Prisma maps only *table* names via @@map; column names stay camelCase and are
-- therefore written as quoted camelCase identifiers below.

ALTER TABLE sale_lines
  ALTER COLUMN quantity TYPE NUMERIC(12, 4) USING quantity::numeric;

ALTER TABLE purchase_lines
  ALTER COLUMN quantity TYPE NUMERIC(12, 4) USING quantity::numeric;
