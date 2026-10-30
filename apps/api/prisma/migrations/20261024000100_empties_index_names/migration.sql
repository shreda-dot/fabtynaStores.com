-- =====================================================================
-- Empties: restore Prisma's camelCase index and constraint names
-- =====================================================================
-- `20261024000000_empties` wrote these five names UNQUOTED, and PostgreSQL
-- folds an unquoted identifier to lower case, so the database kept
-- `empties_owners_normalizedkey_key` instead of the name Prisma records for
-- `@unique(map: "empties_owners_normalizedKey_key")`. `db:verify` pins that
-- name in `EXPECTED_INDEXES` and therefore failed with
-- "missing from the database".
--
-- The other four are declared in `schema.prisma` without a `map`, so Prisma
-- expects its own camelCase spelling and would have emitted a rename (as a
-- DROP + CREATE) on the next `migrate dev`.
--
-- An applied migration must never be edited — its checksum is recorded in
-- `_prisma_migrations` and `db:verify` checks it — so the correction is a
-- rename migration, exactly as `20261020000700_expense_category_index_names`
-- repaired the same mistake for `expense_categories` / `expenses`.
--
-- Only the NAMES change. No index definition, constraint, trigger or row is
-- touched, and this is a no-op for a database that was created from a
-- corrected migration file (the camelCase names already exist there and the
-- folded ones do not).

ALTER INDEX empties_owners_normalizedkey_key
  RENAME TO "empties_owners_normalizedKey_key";

ALTER INDEX empties_movements_typeid_occurredat_idx
  RENAME TO "empties_movements_typeId_occurredAt_idx";

ALTER INDEX empties_movements_occurredat_idx
  RENAME TO "empties_movements_occurredAt_idx";

ALTER INDEX empties_movements_reversesentryid_idx
  RENAME TO "empties_movements_reversesEntryId_idx";

ALTER TABLE empties_movements
  RENAME CONSTRAINT empties_movements_reversesentryid_fkey
  TO "empties_movements_reversesEntryId_fkey";
