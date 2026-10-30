-- =====================================================================
-- Restore the account-ledger `note` exemption the empties migration dropped
-- =====================================================================
-- `20261020000400_reverse_payment_guards` taught the shared reversal-integrity
-- trigger that an ACCOUNT ledger reversal carries the operator's REASON in its
-- own `note`, so `note` must not be compared against the target:
--
--     IF TG_TABLE_NAME = 'account_ledger_entries' THEN
--       excluded_columns := excluded_columns || ARRAY['note'];
--     END IF;
--
-- `20261024000000_empties` rewrote the same function to add the empties
-- magnitude column (`quantity`). Its header claims the body is "the same body
-- as `20261017120000`" — but `20261017120000` predates `20261020000400`, so
-- the rewrite silently reverted the `note` exemption. Every payment reversal
-- then died with
--   P0001: A reversal must negate amountKobo and match its target on type and
--          every source column (account_ledger_entries)
-- which the request handler maps to a 409 CONFLICT. This migration restores
-- the branch.
--
-- The `createdById` entry added by `20261024000000` is kept: it is an ACTOR
-- column, not a source column, and of the six tables that carry this trigger
-- only `empties_movements` has that column at all, so subtracting it is a
-- no-op for the other five.
--
-- Nothing about the schema changes: the function keeps its name, so
-- `expected-schema.ts` gains only this migration's folder name. The applied
-- migration is left untouched, because `db:verify` checksums it.

CREATE OR REPLACE FUNCTION fn_check_reversal_integrity()
RETURNS trigger AS $$
DECLARE
  target_json JSONB;
  magnitude_column TEXT;
  magnitude_value BIGINT;
  excluded_columns TEXT[] := ARRAY['id', 'occurredAt', 'createdAt', 'reversesEntryId', 'createdById'];
BEGIN
  IF NEW."reversesEntryId" IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'account_ledger_entries' THEN
    excluded_columns := excluded_columns || ARRAY['note'];
  END IF;

  magnitude_column :=
    CASE TG_TABLE_NAME
      WHEN 'stock_movements' THEN 'quantityUnits'
      WHEN 'empties_movements' THEN 'quantity'
      ELSE 'amountKobo'
    END;

  EXECUTE format('SELECT to_jsonb(t) FROM %I t WHERE id = $1', TG_TABLE_NAME)
    INTO target_json
    USING NEW."reversesEntryId";

  IF target_json IS NULL THEN
    RAISE EXCEPTION 'Reversal target % not found on %.',
      NEW."reversesEntryId", TG_TABLE_NAME;
  END IF;

  magnitude_value := (target_json ->> magnitude_column)::bigint;

  IF (to_jsonb(NEW) - excluded_columns) IS DISTINCT FROM (
    (target_json - excluded_columns)
    || jsonb_build_object(magnitude_column, -magnitude_value)
  ) THEN
    RAISE EXCEPTION
      'A reversal must negate % and match its target on type and every source column (%).',
      magnitude_column, TG_TABLE_NAME;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
