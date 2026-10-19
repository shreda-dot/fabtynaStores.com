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
  listAccounts(): Promise<AccountDto[]>;

  createAccount(input: CreateAccountDto): Promise<AccountDto>;

  updateAccount(id: string, input: UpdateAccountDto): Promise<AccountDto>;

  /**
   * Deactivates an account. Refused if the account balance is not zero.
   * Deactivated accounts cannot receive new entries (except reversals).
   */
  deactivateAccount(id: string, input: DeactivateAccountDto): Promise<AccountDto>;

  /**
   * Posts the initial balance for an account. Refused if the account already
   * has a live opening balance.
   */
  recordOpeningBalance(input: CreateOpeningBalanceDto): Promise<AccountLedgerEntryDto>;

  /**
   * Posts an ADJUSTMENT entry to match the ledger to a physical count.
   */
  reconcileAccount(input: ReconcileAccountDto): Promise<AccountLedgerEntryDto>;

  /**
   * Records a transfer of money between two accounts (TRANSFER_OUT from source,
   * TRANSFER_IN to destination).
   */
  recordTransfer(input: CreateAccountTransferDto): Promise<void>;

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
  }): Promise<AccountLedgerEntryDto>;

  /**
   * Ledger entries for an account, newest first, optionally limited to a
   * half-open business-date window.
   */
  listLedgerEntries(
    accountId: string,
    options?: { from?: string; to?: string },
  ): Promise<AccountLedgerEntryDto[]>;

  /** A one-time reminder emitted when legacy mock data is migrated. */
  getMigrationNotice(): Promise<AccountMigrationNotice | null>;

  /** Persists acknowledgement of a migration reminder in browser storage. */
  dismissMigrationNotice(id: string): Promise<void>;
}
