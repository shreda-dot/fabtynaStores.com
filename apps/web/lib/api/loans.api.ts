import type {
  AddLoanChargeDto,
  CreateLoanDto,
  LoanDto,
  LoanLedgerEntryDto,
  LoanRepaymentDto,
  LoanStatus,
  RecordLoanRepaymentDto,
} from "@fabtyna/shared";

export type LoanListItemDto = Omit<LoanDto, "agreedInterestKobo" | "note" | "createdAt"> &
  Partial<Pick<LoanDto, "agreedInterestKobo" | "note" | "createdAt">> & {
    /** Outstanding = DISBURSEMENT + CHARGE - REPAYMENT. */
    outstandingKobo: string;
    /** Everything charged so far (principal + interest + penalties). */
    totalRepayableKobo: string;
    repaidKobo: string;
    status: LoanStatus;
  };

/** What the server returned after saving a repayment (real mode only). */
export type SavedRepaymentDto = {
  id: string;
  amountKobo: string;
  interestPortionKobo: string;
  paidAt: string;
  accountId: string | null;
};

export type LoanRepaymentRecordDto = LoanRepaymentDto & {
  accountId?: string | null;
  accountName?: string | null;
  reversed?: boolean;
};

export type LoanDetailDto = LoanDto & {
  outstandingKobo: string;
  status: LoanStatus;
  ledger: LoanLedgerEntryDto[];
  repayments: LoanRepaymentRecordDto[];
  /** Present in real mode, straight from the API summary. */
  chargesKobo?: string;
  totalRepayableKobo?: string;
  repaidKobo?: string;
};

export type LoanDetailWithSavedRepayment = LoanDetailDto & {
  savedRepayment?: SavedRepaymentDto;
};

export type LoanListOptions = {
  /** Omitted = the API default: ACTIVE and OVERDUE (not PAID). */
  status?: LoanStatus;
  search?: string;
  /** Lagos YYYY-MM-DD; loans due on or before this date. */
  dueBefore?: string;
};

export type LoanListPageDto = {
  items: LoanListItemDto[];
  nextCursor: string | null;
};

export interface LoansApi {
  list(options?: LoanListOptions): Promise<LoanListItemDto[]>;
  listPage(options?: LoanListOptions & { cursor?: string; limit?: number }): Promise<LoanListPageDto>;
  getById(id: string): Promise<LoanDetailDto>;
  create(input: CreateLoanDto, idempotencyKey?: string): Promise<LoanDetailDto>;
  addCharge(id: string, input: AddLoanChargeDto, idempotencyKey?: string): Promise<LoanDetailDto>;
  recordRepayment(
    id: string,
    input: RecordLoanRepaymentDto,
    idempotencyKey?: string,
  ): Promise<LoanDetailWithSavedRepayment>;
}
