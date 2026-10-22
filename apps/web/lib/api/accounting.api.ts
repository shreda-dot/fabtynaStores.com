import type {
  AccountDto,
  AccountEntryType,
  AccountLedgerEntryDto,
  AccountMoneyFlowCategoryKey,
  AccountingPositionOptionsDto,
  CreateAccountDto,
  CreateAccountTransferDto,
  CreateOpeningBalanceDto,
  DeactivateAccountDto,
  FinancialPositionResult,
  ReconcileAccountDto,
  UpdateAccountDto,
} from "@fabtyna/shared";

export interface AccountMigrationNotice {
  id: string;
  title: string;
  message: string;
}

export type AccountRecordDto = AccountDto & { balanceKobo?: string };

export type AccountStatementEntryDto = {
  id: string;
  type: AccountEntryType;
  amountKobo: string;
  occurredAt: string | null;
  note: string | null;
  sourceDescription: string;
  isReversal: boolean;
  reversesEntryId: string | null;
  reversedByEntryId: string | null;
  runningBalanceKobo: string;
};

export type AccountStatementPageDto = {
  account: { id: string; name: string };
  from: string | null;
  to: string | null;
  openingBalanceKobo: string;
  closingBalanceKobo: string;
  entries: AccountStatementEntryDto[];
  nextCursor: string | null;
};

export interface MoneyFlowCategoryDto {
  key: AccountMoneyFlowCategoryKey;
  moneyInKobo: string;
  moneyOutKobo: string;
}

export interface MoneyFlowAccountDto {
  accountId: string;
  accountName: string;
  accountType: AccountDto["type"];
  openingBalanceKobo: string;
  moneyInKobo: string;
  moneyOutKobo: string;
  netKobo: string;
  closingBalanceKobo: string;
  categories: MoneyFlowCategoryDto[];
}

export interface MoneyFlowReportDto {
  rows: MoneyFlowAccountDto[];
  totals: {
    openingBalanceKobo: string;
    moneyInKobo: string;
    moneyOutKobo: string;
    netKobo: string;
    closingBalanceKobo: string;
  };
  sales: {
    billedKobo: string;
    customerMoneyReceivedKobo: string;
    debtOutstandingKobo: string;
  };
}

export interface AccountingApi {
  /**
   * Gathers stock, receivables, cash, payables and loans from the store and
   * runs the pure `computeFinancialPosition` domain function. Amounts are
   * bigint kobo (never floats).
   */
  position(options?: AccountingPositionOptionsDto): Promise<FinancialPositionResult>;

  /** Account cash flow and sales cash-collection context for Lagos dates. */
  moneyFlow(
    from: string,
    to: string,
    accountId?: string,
  ): Promise<MoneyFlowReportDto>;

  /* Accounts --------------------------------------------------------------- */

  /** All accounts, active first, then by name. */
  listAccounts(includeInactive?: boolean): Promise<AccountRecordDto[]>;

  /** Active accounts used to receive or fund a payment. */
  listPaymentAccounts(): Promise<AccountRecordDto[]>;

  createAccount(input: CreateAccountDto, idempotencyKey?: string): Promise<AccountRecordDto>;

  updateAccount(id: string, input: UpdateAccountDto, idempotencyKey?: string): Promise<AccountRecordDto>;

  /**
   * Deactivates an account. Refused if the account balance is not zero.
   * Deactivated accounts cannot receive new entries (except reversals).
   */
  deactivateAccount(id: string, input: DeactivateAccountDto, idempotencyKey?: string): Promise<AccountRecordDto>;
  reactivateAccount?(id: string, idempotencyKey?: string): Promise<AccountRecordDto>;

  /**
   * Posts the initial balance for an account. Refused if the account already
   * has a live opening balance.
   */
  recordOpeningBalance(input: CreateOpeningBalanceDto, idempotencyKey?: string): Promise<AccountLedgerEntryDto>;

  /**
   * Posts an ADJUSTMENT entry to match the ledger to a physical count.
   */
  reconcileAccount(
    input: ReconcileAccountDto,
    idempotencyKey?: string,
    countedAmountKobo?: string,
  ): Promise<AccountLedgerEntryDto>;

  /**
   * Records a transfer of money between two accounts (TRANSFER_OUT from source,
   * TRANSFER_IN to destination).
   */
  recordTransfer(input: CreateAccountTransferDto, idempotencyKey?: string): Promise<void | { id: string }>;
  reverseTransfer?(id: string, reason: string, idempotencyKey?: string): Promise<void>;
  reverseEntry?(id: string, reason: string, idempotencyKey?: string): Promise<AccountLedgerEntryDto>;

  /** Records manual capital, income, drawings or bank/POS charges. */
  recordManualEntry(input: {
    accountId: string;
    type: Extract<
      AccountEntryType,
      "OWNER_CAPITAL" | "OTHER_INCOME" | "OWNER_DRAWING" | "BANK_OR_POS_CHARGE"
    >;
    amountKobo: string;
    note: string;
    occurredAt: string;
  }, idempotencyKey?: string): Promise<AccountLedgerEntryDto>;

  /**
   * Ledger entries for an account, newest first, optionally limited to a
   * half-open business-date window.
   */
  listLedgerEntries(
    accountId: string,
    options?: { from?: string; to?: string },
  ): Promise<AccountLedgerEntryDto[]>;
  statementPage?(
    accountId: string,
    options?: { from?: string; to?: string; cursor?: string; limit?: number },
  ): Promise<AccountStatementPageDto>;

  /** A one-time reminder emitted when legacy mock data is migrated. */
  getMigrationNotice(): Promise<AccountMigrationNotice | null>;

  /** Persists acknowledgement of a migration reminder in browser storage. */
  dismissMigrationNotice(id: string): Promise<void>;
}
