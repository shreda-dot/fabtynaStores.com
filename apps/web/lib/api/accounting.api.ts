import type {
  AccountingPositionOptionsDto,
  FinancialPositionResult,
} from "@fabtyna/shared";

export interface AccountingApi {
  /**
   * Gathers stock, receivables, cash, payables and loans from the store and
   * runs the pure `computeFinancialPosition` domain function. Amounts are
   * bigint kobo (never floats).
   */
  position(options?: AccountingPositionOptionsDto): Promise<FinancialPositionResult>;
}
