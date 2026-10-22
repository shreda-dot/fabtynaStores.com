import type { SaleChannel } from "@fabtyna/shared";

export type ExpenseCategoryDto = {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
  createdAt: string;
  expenseCount: number;
};

export type ExpenseRecordDto = {
  id: string;
  categoryId: string;
  categoryName: string;
  accountId: string | null;
  accountName: string | null;
  /** Set by the real API: true for LOAN_INTEREST rows created by a loan repayment. */
  systemManaged?: boolean;
  categoryCode?: string | null;
  loanRepaymentId?: string | null;
  channel: SaleChannel;
  description: string;
  amountKobo: string;
  expenseDate: string;
  voided: boolean;
  voidedAt: string | null;
  voidReason: string | null;
};

export type CreateExpenseInput = {
  categoryId: string;
  channel: SaleChannel;
  description: string;
  amountKobo: string;
  expenseDate: string;
  accountId: string;
};

export type ExpenseListOptions = {
  from?: string;
  to?: string;
  categoryId?: string;
  channel?: SaleChannel;
  includeVoided?: boolean;
};

export type ExpenseListPageDto = {
  items: ExpenseRecordDto[];
  nextCursor: string | null;
  from: string | null;
  to: string | null;
};

export type ExpenseSummaryDto = {
  from: string | null;
  to: string | null;
  totalKobo: string;
  count: number;
  byCategory: { id: string; name: string; totalKobo: string; count: number }[];
};

export type ExpenseAmendResultDto = {
  expense: ExpenseRecordDto;
  voidedExpenseId: string;
};

export interface ExpensesApi {
  list(options?: ExpenseListOptions): Promise<ExpenseRecordDto[]>;
  listPage(options?: ExpenseListOptions & { cursor?: string; limit?: number }): Promise<ExpenseListPageDto>;
  summary(options?: ExpenseListOptions): Promise<ExpenseSummaryDto>;
  create(input: CreateExpenseInput, idempotencyKey?: string): Promise<ExpenseRecordDto>;
  void(id: string, reason: string, idempotencyKey?: string): Promise<ExpenseRecordDto>;
  amend(id: string, input: CreateExpenseInput, idempotencyKey?: string): Promise<ExpenseAmendResultDto>;
  listCategories?(includeInactive?: boolean): Promise<ExpenseCategoryDto[]>;
  createCategory?(name: string, idempotencyKey?: string): Promise<ExpenseCategoryDto>;
  renameCategory?(id: string, name: string, idempotencyKey?: string): Promise<ExpenseCategoryDto>;
  setCategoryActive?(id: string, isActive: boolean, idempotencyKey?: string): Promise<ExpenseCategoryDto>;
}
