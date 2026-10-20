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
