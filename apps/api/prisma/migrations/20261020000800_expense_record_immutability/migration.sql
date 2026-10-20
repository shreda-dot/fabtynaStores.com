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
    RAISE EXCEPTION 'expenses.categoryId is immutable once created.';
  END IF;
  IF NEW.channel IS DISTINCT FROM OLD.channel
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW."amountKobo" IS DISTINCT FROM OLD."amountKobo"
     OR NEW."expenseDate" IS DISTINCT FROM OLD."expenseDate" THEN
    RAISE EXCEPTION 'Expense details are immutable; void the expense with a reason and recreate it.';
  END IF;
  IF OLD."voidedAt" IS NOT NULL
     AND (NEW."voidedAt" IS DISTINCT FROM OLD."voidedAt"
       OR NEW."voidReason" IS DISTINCT FROM OLD."voidReason") THEN
    RAISE EXCEPTION 'A voided expense cannot be changed again.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
