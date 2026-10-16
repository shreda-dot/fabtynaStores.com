import type {
  AddLoanChargeDto,
  CreateLoanDto,
  LoanDto,
  LoanLedgerEntryDto,
  LoanRepaymentDto,
  LoanStatus,
  RecordLoanRepaymentDto,
} from "@fabtyna/shared";

export type LoanListItemDto = LoanDto & {
  /** Outstanding = DISBURSEMENT + CHARGE - REPAYMENT. */
  outstandingKobo: string;
  /** Everything charged so far (principal + interest + penalties). */
  totalRepayableKobo: string;
  repaidKobo: string;
  status: LoanStatus;
};

export type LoanDetailDto = LoanDto & {
  outstandingKobo: string;
  status: LoanStatus;
  ledger: LoanLedgerEntryDto[];
  repayments: LoanRepaymentDto[];
};

export interface LoansApi {
  list(): Promise<LoanListItemDto[]>;
  getById(id: string): Promise<LoanDetailDto>;
  create(input: CreateLoanDto): Promise<LoanDetailDto>;
  addCharge(id: string, input: AddLoanChargeDto): Promise<LoanDetailDto>;
  recordRepayment(
    id: string,
    input: RecordLoanRepaymentDto,
  ): Promise<LoanDetailDto>;
}
