-- =====================================================================
-- The two accounts every business starts with
-- =====================================================================
-- The accounts subsystem makes an account mandatory on every payment, so a
-- fresh database needs somewhere for that money to land before the owner has
-- created any account of their own. This migration installs the same two
-- defaults the mock store synthesises on its v6 -> v7 backfill
-- (`packages/shared/src/mock-store-migration.ts`, `DEFAULT_ACCOUNT_*`):
--
--   * "Cash on hand"  (CASH) — money physically in the drawer;
--   * "Moniepoint"    (BANK) — the bank / transfer account.
--
-- IDS ARE GENERATED HERE, NOT BY PRISMA
-- -------------------------------------
-- `Account.id` is `@default(cuid())` in `schema.prisma`, but that default is
-- applied *client-side* by the Prisma client: raw SQL `INSERT`s get no value
-- for it. The ids are therefore minted in this file with
-- `gen_random_uuid()::text` (built into PostgreSQL 13+; this database is 18).
--
-- `updatedAt` is `@updatedAt` in the schema, which Prisma also fills in
-- client-side; the column is `NOT NULL` with no database default, so the
-- INSERTs below supply `now()` explicitly. (`createdAt` does have a
-- `DEFAULT CURRENT_TIMESTAMP`, but it is written out too so both timestamps of
-- a default account are visibly identical.)
--
-- IDEMPOTENT BY NAME
-- ------------------
-- Each insert is guarded on the name, so re-running against a database that
-- already carries the defaults (or a hand-created account of the same name)
-- adds nothing. NOTE for tests and future migrations: **`accounts` is NOT
-- empty after this migration** — both `fabtyna_dev` and `fabtyna_test` hold
-- exactly these two rows unless the operator has since added more. No test or
-- fixture may assume an empty `accounts` table.

INSERT INTO accounts (id, name, type, "isActive", "deactivatedAt", note, "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  'Cash on hand',
  'CASH',
  true,
  NULL,
  'Money physically in the drawer.',
  now(),
  now()
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE name = 'Cash on hand');

INSERT INTO accounts (id, name, type, "isActive", "deactivatedAt", note, "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  'Moniepoint',
  'BANK',
  true,
  NULL,
  'Bank / transfer account.',
  now(),
  now()
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE name = 'Moniepoint');
