DROP TRIGGER trg_expense_immutability ON expenses;

CREATE TABLE expense_categories (
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  "normalizedKey" TEXT NOT NULL,
  code TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT expense_categories_pkey PRIMARY KEY (id),
  CONSTRAINT ck_expense_categories_name CHECK (
    char_length(btrim(name)) BETWEEN 1 AND 60
  ),
  CONSTRAINT ck_expense_categories_normalized_key CHECK (
    "normalizedKey" = lower(btrim(name))
  )
);

CREATE UNIQUE INDEX expense_categories_normalizedKey_key
  ON expense_categories ("normalizedKey");
CREATE UNIQUE INDEX expense_categories_code_key
  ON expense_categories (code);

INSERT INTO expense_categories (id, name, "normalizedKey", code)
VALUES
  ('sys-exp-cat-rent', 'Rent', 'rent', 'RENT'),
  ('sys-exp-cat-utility', 'Utility', 'utility', 'UTILITY'),
  ('sys-exp-cat-salary', 'Salary', 'salary', 'SALARY'),
  ('sys-exp-cat-transport', 'Transport', 'transport', 'TRANSPORT'),
  ('sys-exp-cat-maintenance', 'Maintenance', 'maintenance', 'MAINTENANCE'),
  ('sys-exp-cat-supplies', 'Supplies', 'supplies', 'SUPPLIES'),
  ('sys-exp-cat-marketing', 'Marketing', 'marketing', 'MARKETING'),
  ('sys-exp-cat-loan-interest', 'Loan interest', 'loan interest', 'LOAN_INTEREST'),
  ('sys-exp-cat-other', 'Other', 'other', 'OTHER')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE expenses ADD COLUMN "categoryId" TEXT;

UPDATE expenses e
   SET "categoryId" = ec.id
  FROM expense_categories ec
 WHERE ec.code = e.category::text;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM expenses WHERE "categoryId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot migrate expenses: one or more categories were not mapped.';
  END IF;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE expenses
  ALTER COLUMN "categoryId" SET NOT NULL,
  ADD CONSTRAINT fk_expenses_category
    FOREIGN KEY ("categoryId") REFERENCES expense_categories (id)
    ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE OR REPLACE FUNCTION fn_check_account_ledger_loan_interest()
RETURNS trigger AS $$
DECLARE
  category_code TEXT;
BEGIN
  IF NEW."expenseId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT ec.code INTO category_code
    FROM expenses e
    JOIN expense_categories ec ON ec.id = e."categoryId"
   WHERE e.id = NEW."expenseId";

  IF category_code = 'LOAN_INTEREST' THEN
    RAISE EXCEPTION
      'A loan-interest expense must not post its own account entry; the repayment covers it.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP INDEX "expenses_category_expenseDate_idx";
CREATE INDEX expenses_categoryId_expenseDate_idx
  ON expenses ("categoryId", "expenseDate");

ALTER TABLE expenses DROP COLUMN category;
DROP TYPE "ExpenseCategory";

CREATE OR REPLACE FUNCTION fn_expense_category_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Expense categories cannot be deleted; deactivate them instead.';
  END IF;

  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'An expense category code is immutable.';
  END IF;

  IF OLD.code IS NOT NULL AND (
    NEW.name IS DISTINCT FROM OLD.name
    OR NEW."normalizedKey" IS DISTINCT FROM OLD."normalizedKey"
    OR NEW."isActive" IS DISTINCT FROM OLD."isActive"
  ) THEN
    RAISE EXCEPTION 'System expense categories cannot be renamed or deactivated.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_expense_category_guard
  BEFORE UPDATE OR DELETE ON expense_categories
  FOR EACH ROW EXECUTE FUNCTION fn_expense_category_guard();

CREATE TRIGGER trg_expense_category_no_truncate
  BEFORE TRUNCATE ON expense_categories
  EXECUTE FUNCTION fn_raise_immutable();

CREATE OR REPLACE FUNCTION fn_check_expense_loan_link()
RETURNS trigger AS $$
DECLARE
  category_code TEXT;
  category_active BOOLEAN;
BEGIN
  SELECT code, "isActive"
    INTO category_code, category_active
    FROM expense_categories
   WHERE id = NEW."categoryId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense category % does not exist.', NEW."categoryId";
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT category_active THEN
      RAISE EXCEPTION 'An inactive expense category cannot be selected.';
    END IF;
    IF category_code = 'LOAN_INTEREST' AND NEW."loanRepaymentId" IS NULL THEN
      RAISE EXCEPTION 'LOAN_INTEREST is reserved for loan repayment interest.';
    END IF;
  ELSIF NEW."categoryId" IS DISTINCT FROM OLD."categoryId" THEN
    IF NOT category_active THEN
      RAISE EXCEPTION 'An inactive expense category cannot be selected.';
    END IF;
    IF category_code = 'LOAN_INTEREST' AND NEW."loanRepaymentId" IS NULL THEN
      RAISE EXCEPTION 'LOAN_INTEREST is reserved for loan repayment interest.';
    END IF;
  END IF;

  IF NEW."loanRepaymentId" IS NOT NULL
     AND category_code IS DISTINCT FROM 'LOAN_INTEREST' THEN
    RAISE EXCEPTION
      'An expense linked to a loan repayment (loanRepaymentId=%) must use category LOAN_INTEREST.',
      NEW."loanRepaymentId";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_expense_immutability()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."loanRepaymentId" IS NOT NULL THEN
      RAISE EXCEPTION
        'A loan-interest expense (loanRepaymentId=%) cannot be deleted; reverse the repayment instead.',
        OLD."loanRepaymentId";
    END IF;
    RAISE EXCEPTION 'Expenses cannot be deleted; void them with a reason instead.';
  END IF;

  IF OLD."loanRepaymentId" IS NOT NULL THEN
    RAISE EXCEPTION
      'A loan-interest expense (loanRepaymentId=%) cannot be updated; reverse the repayment instead.',
      OLD."loanRepaymentId";
  END IF;

  IF NEW."loanRepaymentId" IS DISTINCT FROM OLD."loanRepaymentId" THEN
    RAISE EXCEPTION 'expenses.loanRepaymentId is immutable once created.';
  END IF;

  IF NEW."categoryId" IS DISTINCT FROM OLD."categoryId" THEN
    RAISE EXCEPTION
      'expenses.categoryId is immutable once created (was %, attempted %).',
      OLD."categoryId", NEW."categoryId";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_expense_immutability
  BEFORE UPDATE OR DELETE ON expenses
  FOR EACH ROW EXECUTE FUNCTION fn_expense_immutability();
