import type {
  Expense,
  Loan,
  LoanLedgerEntry,
  LoanRepayment,
} from "./types.ts";
import type { IdGenerator } from "./operations.ts";

export interface CreateLoanInput {
  lenderName: string;
  principalKobo: bigint;
  agreedInterestKobo: bigint;
  disbursedAt: Date;
  dueDate: string | null;
  note: string | null;
}

export interface CreateLoanResult {
  loan: Loan;
  ledgerEntries: LoanLedgerEntry[];
}

export function createLoan(
  input: CreateLoanInput,
  newId: IdGenerator,
): CreateLoanResult {
  if (input.lenderName.trim() === "") {
    throw new RangeError("A loan must have a lender.");
  }
  if (!Number.isFinite(input.disbursedAt.getTime())) {
    throw new RangeError("Loan disbursement date must be valid.");
  }
  if (input.principalKobo <= 0n) {
    throw new RangeError("Loan principal must be positive.");
  }
  if (input.agreedInterestKobo < 0n) {
    throw new RangeError("Agreed interest must not be negative.");
  }

  const loanId = newId();
  const loan: Loan = {
    id: loanId,
    lenderName: input.lenderName.trim(),
    principalKobo: input.principalKobo,
    agreedInterestKobo: input.agreedInterestKobo,
    disbursedAt: input.disbursedAt,
    dueDate: input.dueDate,
    note: input.note,
    createdAt: input.disbursedAt,
  };

  const ledgerEntries: LoanLedgerEntry[] = [
    {
      id: newId(),
      loanId,
      type: "DISBURSEMENT",
      amountKobo: input.principalKobo,
      loanRepaymentId: null,
      reversesEntryId: null,
      note: null,
      occurredAt: input.disbursedAt,
    },
  ];

  if (input.agreedInterestKobo > 0n) {
    ledgerEntries.push({
      id: newId(),
      loanId,
      type: "CHARGE",
      amountKobo: input.agreedInterestKobo,
      loanRepaymentId: null,
      reversesEntryId: null,
      note: "Agreed interest at disbursement",
      occurredAt: input.disbursedAt,
    });
  }

  return { loan, ledgerEntries };
}

export interface AddLoanChargeInput {
  loanId: string;
  amountKobo: bigint;
  reason: string;
  occurredAt: Date;
}

export function addLoanCharge(
  input: AddLoanChargeInput,
  existingLoans: readonly Loan[],
  newId: IdGenerator,
): LoanLedgerEntry {
  if (!Number.isFinite(input.occurredAt.getTime())) {
    throw new RangeError("Charge date must be valid.");
  }
  if (input.amountKobo <= 0n) {
    throw new RangeError("A loan charge must be positive.");
  }
  if (input.reason.trim() === "") {
    throw new RangeError("A loan charge needs a reason.");
  }
  if (!existingLoans.some((loan) => loan.id === input.loanId)) {
    throw new RangeError(`Loan '${input.loanId}' not found.`);
  }

  return {
    id: newId(),
    loanId: input.loanId,
    type: "CHARGE",
    amountKobo: input.amountKobo,
    loanRepaymentId: null,
    reversesEntryId: null,
    note: input.reason.trim(),
    occurredAt: input.occurredAt,
  };
}

export interface RecordLoanRepaymentInput {
  loanId: string;
  amountKobo: bigint;
  interestPortionKobo: bigint;
  paidAt: Date;
  note: string | null;
}

export interface RecordLoanRepaymentResult {
  repayment: LoanRepayment;
  ledgerEntry: LoanLedgerEntry;
  /**
   * Linked LOAN_INTEREST expense created when `interestPortionKobo > 0`.
   * Carries `loanRepaymentId` so it can be reversed with the repayment
   * instead of edited — principal-only repayments never create one.
   */
  expense: Expense | null;
}

export function recordLoanRepayment(
  input: RecordLoanRepaymentInput,
  existingLoans: readonly Loan[],
  existingLedgerEntries: readonly LoanLedgerEntry[],
  newId: IdGenerator,
): RecordLoanRepaymentResult {
  if (!Number.isFinite(input.paidAt.getTime())) {
    throw new RangeError("Repayment date must be valid.");
  }
  if (input.amountKobo <= 0n) {
    throw new RangeError("Repayment amount must be positive.");
  }
  if (input.interestPortionKobo < 0n) {
    throw new RangeError("Interest portion must not be negative.");
  }
  if (input.interestPortionKobo > input.amountKobo) {
    throw new RangeError("Interest portion may not exceed the repayment amount.");
  }

  const loan = existingLoans.find((candidate) => candidate.id === input.loanId);
  if (!loan) {
    throw new RangeError(`Loan '${input.loanId}' not found.`);
  }

  let outstanding = 0n;
  for (const entry of existingLedgerEntries) {
    if (entry.loanId === input.loanId) outstanding += entry.amountKobo;
  }
  if (outstanding <= 0n) {
    throw new RangeError("This loan is already fully repaid.");
  }
  if (input.amountKobo > outstanding) {
    throw new RangeError(
      `Repayment exceeds the outstanding balance of ${outstanding.toString()} kobo.`,
    );
  }

  const repaymentId = newId();
  const expenseId = input.interestPortionKobo > 0n ? newId() : null;

  const repayment: LoanRepayment = {
    id: repaymentId,
    loanId: input.loanId,
    amountKobo: input.amountKobo,
    interestPortionKobo: input.interestPortionKobo,
    expenseId,
    note: input.note,
    paidAt: input.paidAt,
    createdAt: input.paidAt,
  };

  const ledgerEntry: LoanLedgerEntry = {
    id: newId(),
    loanId: input.loanId,
    type: "REPAYMENT",
    amountKobo: -input.amountKobo,
    loanRepaymentId: repaymentId,
    reversesEntryId: null,
    note: input.note,
    occurredAt: input.paidAt,
  };

  let expense: Expense | null = null;
  if (expenseId !== null) {
    expense = {
      id: expenseId,
      channel: "BOTH",
      category: "LOAN_INTEREST",
      description: `Loan interest — ${loan.lenderName}`,
      amountKobo: input.interestPortionKobo,
      expenseDate: input.paidAt,
      loanRepaymentId: repaymentId,
      createdAt: input.paidAt,
      updatedAt: input.paidAt,
    };
  }

  return { repayment, ledgerEntry, expense };
}
