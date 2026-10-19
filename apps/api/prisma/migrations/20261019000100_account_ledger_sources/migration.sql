-- =====================================================================
-- Accounts become the source of truth for money
-- =====================================================================
-- One migration installs the whole account subsystem on top of the existing
-- account tables:
--
--   A. `accounts`             soft-delete becomes deactivation
--   B. payment rows           `accountId` becomes mandatory
--   C. `account_ledger_entries`  new PURCHASE / LOAN / LOAN_REPAYMENT sources
--   D. `account_transfers`    the document behind a TRANSFER_IN/OUT pair
--   E. `account_balances`     the derived, never-below-zero cache
--   F. `expenses`             void-with-reason columns
--   G. account-ledger rules   single source, sign, note, opening balance
--   H. account-ledger triggers + the balance maintainer
--
-- The four new `AccountEntryType` values are added by the PREVIOUS migration
-- (`…_account_entry_type_values`): PostgreSQL refuses to use a label in the
-- same transaction that created it, and Prisma runs one migration per
-- transaction.
--
-- Prisma maps only *table* names via @@map; column names stay camelCase and
-- are therefore written as quoted camelCase identifiers below.

-- =====================================================================
-- A. accounts: `deletedAt` -> `isActive` / `deactivatedAt`, plus `note`
-- =====================================================================
-- Deleting an account would strip it from the ledger it explains, so an
-- account is retired by deactivation instead. Both states are kept in step:
-- an active account carries no deactivation date and a deactivated one
-- always carries it (mirrors `validateAccount` in
-- packages/shared/src/domain/accounts.ts).
ALTER TABLE accounts ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE accounts ADD COLUMN "deactivatedAt" TIMESTAMP(3);
ALTER TABLE accounts ADD COLUMN note TEXT;

UPDATE accounts SET "deactivatedAt" = "deletedAt" WHERE "deletedAt" IS NOT NULL;
UPDATE accounts SET "isActive" = false WHERE "deletedAt" IS NOT NULL;

DROP INDEX IF EXISTS "accounts_deletedAt_type_idx";
ALTER TABLE accounts DROP COLUMN "deletedAt";

CREATE INDEX "accounts_isActive_type_idx" ON accounts ("isActive", type);

ALTER TABLE accounts
  ADD CONSTRAINT ck_accounts_deactivation_pair
  CHECK (
    ("isActive" AND "deactivatedAt" IS NULL)
    OR (NOT "isActive" AND "deactivatedAt" IS NOT NULL)
  );

-- =====================================================================
-- B. payment rows: `accountId` is mandatory
-- =====================================================================
-- Every new payment lands in a named account; the destination account's
-- type (CASH / BANK / POS) is what records how the money arrived, so
-- `sale_payments` deliberately gains no `method` column. `supplier_payments`
-- keeps its pre-existing `method` column untouched.
ALTER TABLE sale_payments ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE supplier_payments ALTER COLUMN "accountId" SET NOT NULL;

-- =====================================================================
-- C. account_ledger_entries: purchase / loan / loan-repayment sources
-- =====================================================================
ALTER TABLE account_ledger_entries ADD COLUMN "purchaseId" TEXT;
ALTER TABLE account_ledger_entries ADD COLUMN "loanId" TEXT;
ALTER TABLE account_ledger_entries ADD COLUMN "loanRepaymentId" TEXT;

ALTER TABLE account_ledger_entries
  ADD CONSTRAINT "account_ledger_entries_purchaseId_fkey"
  FOREIGN KEY ("purchaseId") REFERENCES purchases (id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE account_ledger_entries
  ADD CONSTRAINT "account_ledger_entries_loanId_fkey"
  FOREIGN KEY ("loanId") REFERENCES loans (id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE account_ledger_entries
  ADD CONSTRAINT "account_ledger_entries_loanRepaymentId_fkey"
  FOREIGN KEY ("loanRepaymentId") REFERENCES loan_repayments (id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "account_ledger_entries_purchaseId_idx"
  ON account_ledger_entries ("purchaseId");
CREATE INDEX "account_ledger_entries_loanId_idx"
  ON account_ledger_entries ("loanId");
CREATE INDEX "account_ledger_entries_loanRepaymentId_idx"
  ON account_ledger_entries ("loanRepaymentId");

-- =====================================================================
-- D. account_transfers: one document behind each TRANSFER_IN/OUT pair
-- =====================================================================
CREATE TABLE account_transfers (
    id              TEXT NOT NULL,
    "fromAccountId" TEXT NOT NULL,
    "toAccountId"   TEXT NOT NULL,
    "amountKobo"    BIGINT NOT NULL,
    note            TEXT,
    "occurredAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT account_transfers_pkey PRIMARY KEY (id),
    CONSTRAINT "account_transfers_fromAccountId_fkey"
      FOREIGN KEY ("fromAccountId") REFERENCES accounts (id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "account_transfers_toAccountId_fkey"
      FOREIGN KEY ("toAccountId") REFERENCES accounts (id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT ck_account_transfers_amount_positive CHECK ("amountKobo" > 0),
    CONSTRAINT ck_account_transfers_different_accounts
      CHECK ("fromAccountId" <> "toAccountId")
);

CREATE INDEX "account_transfers_fromAccountId_idx"
  ON account_transfers ("fromAccountId");
CREATE INDEX "account_transfers_toAccountId_idx"
  ON account_transfers ("toAccountId");
CREATE INDEX "account_transfers_occurredAt_idx"
  ON account_transfers ("occurredAt");

-- The ledger side of the transfer. The FK lives here (not in section C)
-- because the table it points at does not exist until above.
ALTER TABLE account_ledger_entries
  ADD CONSTRAINT "account_ledger_entries_accountTransferId_fkey"
  FOREIGN KEY ("accountTransferId") REFERENCES account_transfers (id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- A transfer is a financial document like any other: append-only.
CREATE TRIGGER trg_account_transfer_immutable
  BEFORE UPDATE OR DELETE ON account_transfers
  FOR EACH ROW EXECUTE FUNCTION fn_raise_immutable();

CREATE TRIGGER trg_account_transfer_no_truncate
  BEFORE TRUNCATE ON account_transfers
  EXECUTE FUNCTION fn_raise_immutable();

-- =====================================================================
-- E. account_balances: the derived "money never goes below zero" cache
-- =====================================================================
-- One row per account holding SUM(account_ledger_entries.amountKobo).
-- Maintained exclusively by an AFTER INSERT trigger on
-- `account_ledger_entries`; nothing else may write it.
--
-- Order matters: the table is created and back-filled BEFORE the triggers
-- below, because the back-fill INSERT would otherwise be rejected by the
-- direct-write guard.
CREATE TABLE account_balances (
    "accountId"   TEXT NOT NULL,
    "balanceKobo" BIGINT NOT NULL DEFAULT 0,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT account_balances_pkey PRIMARY KEY ("accountId"),
    CONSTRAINT "account_balances_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES accounts (id) ON DELETE RESTRICT,
    CONSTRAINT ck_account_balances_nonnegative CHECK ("balanceKobo" >= 0)
);

INSERT INTO account_balances ("accountId", "balanceKobo")
SELECT "accountId", SUM("amountKobo")
  FROM account_ledger_entries
 GROUP BY "accountId";

-- =====================================================================
-- F. expenses: voiding with a reason instead of editing away the outflow
-- =====================================================================
-- An expense that has moved money out of an account is never edited into a
-- different amount: it is voided, the account entry is reversed, and the
-- expense leaves the reports. `voidReason` is required exactly when
-- `voidedAt` is set (mirrors `validateExpenseVoidFields`).
ALTER TABLE expenses ADD COLUMN "voidedAt" TIMESTAMP(3);
ALTER TABLE expenses ADD COLUMN "voidReason" TEXT;

ALTER TABLE expenses
  ADD CONSTRAINT ck_expenses_void_pair
  CHECK (
    ("voidedAt" IS NULL AND "voidReason" IS NULL)
    OR (
      "voidedAt" IS NOT NULL
      AND "voidReason" IS NOT NULL
      AND btrim("voidReason") <> ''
    )
  );

-- =====================================================================
-- G. account ledger rules
-- =====================================================================

-- ---- at most one source column per entry ----
-- Source-less types are legitimate (opening balance, owner capital/drawings,
-- bank/POS charge, adjustment); which source a *typed* entry must carry is
-- enforced by `trg_account_ledger_source` in section H.
ALTER TABLE account_ledger_entries
  ADD CONSTRAINT ck_account_ledger_single_source
  CHECK (
    (
      (CASE WHEN "salePaymentId"     IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN "customerPaymentId" IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN "supplierPaymentId" IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN "purchaseId"        IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN "expenseId"         IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN "otherIncomeId"     IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN "accountTransferId" IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN "customerRefundId"  IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN "loanId"            IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN "loanRepaymentId"   IS NOT NULL THEN 1 ELSE 0 END)
    ) <= 1
  );

-- ---- sign rules, now covering the four new types ----
-- DROP + ADD keeps the constraint NAME so `expected-schema.ts` and every
-- existing FAIL-on-rename guarantee stay valid. The reversal exemption is
-- carried over from `20261017070000_reversal_sign_exemption`.
ALTER TABLE account_ledger_entries
  DROP CONSTRAINT ck_account_ledger_amount_sign;
ALTER TABLE account_ledger_entries
  ADD CONSTRAINT ck_account_ledger_amount_sign
  CHECK (
    "reversesEntryId" IS NOT NULL
    OR (
      "amountKobo" <> 0
      AND (
        (type = 'SALE_PAYMENT'       AND "amountKobo" > 0)
        OR (type = 'CUSTOMER_PAYMENT'   AND "amountKobo" > 0)
        OR (type = 'SUPPLIER_PAYMENT'   AND "amountKobo" < 0)
        OR (type = 'PURCHASE_PAYMENT'   AND "amountKobo" < 0)
        OR (type = 'EXPENSE'            AND "amountKobo" < 0)
        OR (type = 'CUSTOMER_REFUND'    AND "amountKobo" < 0)
        OR (type = 'TRANSFER_IN'        AND "amountKobo" > 0)
        OR (type = 'TRANSFER_OUT'       AND "amountKobo" < 0)
        OR (type = 'OWNER_CAPITAL'      AND "amountKobo" > 0)
        OR (type = 'OWNER_DRAWING'      AND "amountKobo" < 0)
        OR (type = 'OTHER_INCOME'       AND "amountKobo" > 0)
        OR (type = 'BANK_OR_POS_CHARGE' AND "amountKobo" < 0)
        OR (type = 'ADJUSTMENT'         AND "amountKobo" <> 0)
        OR (type = 'OPENING_BALANCE'    AND "amountKobo" > 0)
        OR (type = 'LOAN_DISBURSEMENT'  AND "amountKobo" > 0)
        OR (type = 'LOAN_REPAYMENT'     AND "amountKobo" < 0)
      )
    )
  );

-- ---- an opening balance only ever carries money in ----
-- A reversal row keeps the target's type and negates its amount, so it is
-- exempt; the sign CHECK above is what makes the pair legal.
ALTER TABLE account_ledger_entries
  ADD CONSTRAINT ck_account_ledger_opening_balance_positive
  CHECK (
    "reversesEntryId" IS NOT NULL
    OR type <> 'OPENING_BALANCE'
    OR "amountKobo" > 0
  );

-- ---- types a human cannot explain away need a note ----
ALTER TABLE account_ledger_entries
  ADD CONSTRAINT ck_account_ledger_requires_note
  CHECK (
    type NOT IN ('ADJUSTMENT', 'OWNER_DRAWING', 'BANK_OR_POS_CHARGE')
    OR ("note" IS NOT NULL AND btrim("note") <> '')
  );

-- ---- one non-reversed entry per new source ----
CREATE UNIQUE INDEX ux_account_ledger_purchase_active
  ON account_ledger_entries ("purchaseId")
  WHERE "reversesEntryId" IS NULL AND "purchaseId" IS NOT NULL;

CREATE UNIQUE INDEX ux_account_ledger_loan_active
  ON account_ledger_entries ("loanId")
  WHERE "reversesEntryId" IS NULL AND "loanId" IS NOT NULL;

CREATE UNIQUE INDEX ux_account_ledger_loan_repayment_active
  ON account_ledger_entries ("loanRepaymentId")
  WHERE "reversesEntryId" IS NULL AND "loanRepaymentId" IS NOT NULL;

-- ---- at most one live opening balance per account ----
-- Later corrections go through a reconcile ADJUSTMENT, never a second
-- opening balance (mirrors `validateAtMostOneLiveOpeningBalance`).
CREATE UNIQUE INDEX ux_account_ledger_opening_balance_active
  ON account_ledger_entries ("accountId")
  WHERE "reversesEntryId" IS NULL AND type = 'OPENING_BALANCE';

-- ---- a transfer owns exactly one TRANSFER_IN and one TRANSFER_OUT ----
-- The index from `20261017000300` keyed on `accountTransferId` alone, which
-- forbade the second half of every transfer. It is replaced by a key that
-- includes the direction; the uniqueness counts distinct types, so exactly
-- one entry of each kind survives per transfer.
DROP INDEX ux_account_ledger_account_transfer_active;

CREATE UNIQUE INDEX ux_account_ledger_transfer_type_active
  ON account_ledger_entries ("accountTransferId", type)
  WHERE "reversesEntryId" IS NULL AND "accountTransferId" IS NOT NULL;

-- =====================================================================
-- H. account ledger triggers and the balance maintainer
-- =====================================================================

-- ---- 1. the source column must be the one the type requires ----
CREATE OR REPLACE FUNCTION fn_check_account_ledger_source()
RETURNS trigger AS $$
DECLARE
  expected_column TEXT;
  actual_column   TEXT;
BEGIN
  expected_column := CASE NEW.type
    WHEN 'SALE_PAYMENT'      THEN 'salePaymentId'
    WHEN 'CUSTOMER_PAYMENT'  THEN 'customerPaymentId'
    WHEN 'SUPPLIER_PAYMENT'  THEN 'supplierPaymentId'
    WHEN 'PURCHASE_PAYMENT'  THEN 'purchaseId'
    WHEN 'EXPENSE'           THEN 'expenseId'
    WHEN 'OTHER_INCOME'      THEN 'otherIncomeId'
    WHEN 'CUSTOMER_REFUND'   THEN 'customerRefundId'
    WHEN 'TRANSFER_IN'       THEN 'accountTransferId'
    WHEN 'TRANSFER_OUT'      THEN 'accountTransferId'
    WHEN 'LOAN_DISBURSEMENT' THEN 'loanId'
    WHEN 'LOAN_REPAYMENT'    THEN 'loanRepaymentId'
    ELSE NULL
  END;

  actual_column := CASE
    WHEN NEW."salePaymentId"     IS NOT NULL THEN 'salePaymentId'
    WHEN NEW."customerPaymentId" IS NOT NULL THEN 'customerPaymentId'
    WHEN NEW."supplierPaymentId" IS NOT NULL THEN 'supplierPaymentId'
    WHEN NEW."purchaseId"        IS NOT NULL THEN 'purchaseId'
    WHEN NEW."expenseId"         IS NOT NULL THEN 'expenseId'
    WHEN NEW."otherIncomeId"     IS NOT NULL THEN 'otherIncomeId'
    WHEN NEW."accountTransferId" IS NOT NULL THEN 'accountTransferId'
    WHEN NEW."customerRefundId"  IS NOT NULL THEN 'customerRefundId'
    WHEN NEW."loanId"            IS NOT NULL THEN 'loanId'
    WHEN NEW."loanRepaymentId"   IS NOT NULL THEN 'loanRepaymentId'
    ELSE NULL
  END;

  IF expected_column IS NULL THEN
    IF actual_column IS NOT NULL THEN
      RAISE EXCEPTION
        'A % account ledger entry must not reference a source document (got %).',
        NEW.type, actual_column;
    END IF;
  ELSIF actual_column IS DISTINCT FROM expected_column THEN
    RAISE EXCEPTION
      'A % account ledger entry must reference its % (got %).',
      NEW.type, expected_column, COALESCE(actual_column, 'nothing');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_account_ledger_source
  BEFORE INSERT ON account_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION fn_check_account_ledger_source();

-- ---- 2. a deactivated account takes no new money, but may be unwound ----
-- A reversal has to be allowed: deactivation is only legal at a zero balance,
-- and unwinding a mistake is exactly what a reversal is for.
CREATE OR REPLACE FUNCTION fn_check_account_ledger_account_active()
RETURNS trigger AS $$
DECLARE
  account_is_active BOOLEAN;
  account_name      TEXT;
BEGIN
  IF NEW."reversesEntryId" IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT "isActive", name INTO account_is_active, account_name
    FROM accounts WHERE id = NEW."accountId";

  -- No row means a missing account; the foreign key reports that far better
  -- than this trigger could.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NOT account_is_active THEN
    RAISE EXCEPTION
      'Account ''%'' is deactivated and cannot receive new entries.', account_name;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_account_ledger_account_active
  BEFORE INSERT ON account_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION fn_check_account_ledger_account_active();

-- ---- 3. an account may only be deactivated when it is empty ----
-- A missing balance row counts as zero, so an account that was created but
-- never used can still be retired. Mirrors `assertAccountDeactivatable`.
CREATE OR REPLACE FUNCTION fn_check_account_deactivation()
RETURNS trigger AS $$
DECLARE
  balance BIGINT;
BEGIN
  IF OLD."isActive" AND NOT NEW."isActive" THEN
    SELECT "balanceKobo" INTO balance
      FROM account_balances WHERE "accountId" = NEW.id;

    IF NOT FOUND THEN
      balance := 0;
    END IF;

    IF balance <> 0 THEN
      RAISE EXCEPTION
        'Account ''%'' still holds % kobo and cannot be deactivated. Move the balance out first.',
        NEW.name, balance;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_account_deactivation_guard
  BEFORE UPDATE OF "isActive" ON accounts
  FOR EACH ROW EXECUTE FUNCTION fn_check_account_deactivation();

-- ---- 4. a loan-interest expense must not own an account entry ----
-- The interest half of a repayment is already covered by the single
-- LOAN_REPAYMENT entry; a second entry would double-count the outflow.
-- Mirrors `validateLoanInterestHasNoAccountEntry`.
CREATE OR REPLACE FUNCTION fn_check_account_ledger_loan_interest()
RETURNS trigger AS $$
DECLARE
  expense_category "ExpenseCategory";
BEGIN
  IF NEW."expenseId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT category INTO expense_category FROM expenses WHERE id = NEW."expenseId";

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF expense_category = 'LOAN_INTEREST' THEN
    RAISE EXCEPTION
      'A loan-interest expense must not post its own account entry; the repayment covers it.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_account_ledger_loan_interest_guard
  BEFORE INSERT ON account_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION fn_check_account_ledger_loan_interest();

-- ---- 5. the maintainer: the ONLY writer of account_balances ----
-- UPDATE first, INSERT only when the account has no row yet. PostgreSQL
-- evaluates a CHECK constraint on the proposed tuple BEFORE unique-index
-- arbitration, so a plain `INSERT … ON CONFLICT DO UPDATE` would reject the
-- very first outflow (a negative proposed balance) even though the merged
-- value is fine. Updating first puts the arithmetic in the SET clause, so
-- `ck_account_balances_nonnegative` sees the merged value. The same defect
-- was found and fixed for `stock_balances` in
-- `20261017130000_stock_balance_maintainer_fix`.
--
-- Race safety: the UPDATE takes the account's row lock, so a second session
-- blocks until the first commits and then adds its own delta to the
-- committed balance. The only new race is the first-ever entry for an
-- account; the loser gets a unique_violation, retries the UPDATE and lands
-- on the arbitrated path.
CREATE OR REPLACE FUNCTION fn_apply_account_ledger_entry()
RETURNS trigger AS $$
DECLARE
  delta BIGINT := NEW."amountKobo";
BEGIN
  LOOP
    UPDATE account_balances
       SET "balanceKobo" = "balanceKobo" + delta,
           "updatedAt" = now()
     WHERE "accountId" = NEW."accountId";

    IF FOUND THEN
      RETURN NULL;  -- AFTER trigger; the return value is ignored
    END IF;

    BEGIN
      INSERT INTO account_balances ("accountId", "balanceKobo")
      VALUES (NEW."accountId", delta);
      RETURN NULL;
    EXCEPTION WHEN unique_violation THEN
      -- Another session created this row in the gap between the UPDATE and
      -- the INSERT. Loop: the UPDATE finds the row now and the arithmetic
      -- happens under its lock.
      NULL;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_account_ledger_apply
  AFTER INSERT ON account_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION fn_apply_account_ledger_entry();

-- ---- 6. guard: reject any balance write that did not come from the trigger ----
CREATE OR REPLACE FUNCTION fn_account_balance_direct_write_guard()
RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() = 0 THEN
    RAISE EXCEPTION
      'account_balances is derived from account_ledger_entries and must not be written directly (attempted %).',
      TG_OP;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_account_balances_guard
  BEFORE INSERT OR UPDATE OR DELETE ON account_balances
  FOR EACH ROW EXECUTE FUNCTION fn_account_balance_direct_write_guard();

CREATE TRIGGER trg_account_balances_no_truncate
  BEFORE TRUNCATE ON account_balances
  EXECUTE FUNCTION fn_raise_immutable();
