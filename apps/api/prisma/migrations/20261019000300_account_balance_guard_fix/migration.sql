-- =====================================================================
-- Repair the account balance write guard and reconcile its derived cache
-- =====================================================================
-- `20261019000100_account_ledger_sources` copied the original stock guard
-- behavior: it tested `pg_trigger_depth() = 0` and returned NULL. The depth
-- test never rejects a direct write (depth is 1 in a row trigger), while the
-- NULL return silently cancels the balance maintainer's nested writes too.
-- Replace it with the tested UPDATE-first guard behavior from the stock
-- balance correction. Never rewrite the applied migration.

DROP TRIGGER trg_account_balances_guard ON account_balances;

CREATE OR REPLACE FUNCTION fn_account_balance_direct_write_guard()
RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION
      'account_balances is derived from account_ledger_entries and must not be written directly (attempted %).',
      TG_OP;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recompute existing cache rows from the immutable source of truth, then add
-- any missing rows. The trigger is temporarily absent within this migration
-- transaction so its direct-write protection does not block this repair.
UPDATE account_balances ab
   SET "balanceKobo" = COALESCE((
         SELECT SUM(ale."amountKobo")
           FROM account_ledger_entries ale
          WHERE ale."accountId" = ab."accountId"
       ), 0),
       "updatedAt" = now();

INSERT INTO account_balances ("accountId", "balanceKobo")
SELECT "accountId", SUM("amountKobo")
  FROM account_ledger_entries
 GROUP BY "accountId"
ON CONFLICT ("accountId") DO NOTHING;

CREATE TRIGGER trg_account_balances_guard
  BEFORE INSERT OR UPDATE OR DELETE ON account_balances
  FOR EACH ROW EXECUTE FUNCTION fn_account_balance_direct_write_guard();
