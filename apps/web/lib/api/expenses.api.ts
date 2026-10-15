import type {
  CreateExpenseDto,
  ExpenseCategory,
  ExpenseDto,
  SaleChannel,
} from "@fabtyna/shared";

export type ExpenseListOptions = {
  from?: string;
  to?: string;
  category?: ExpenseCategory;
  channel?: SaleChannel;
};

export interface ExpensesApi {
  list(options?: ExpenseListOptions): Promise<ExpenseDto[]>;
  getById(id: string): Promise<ExpenseDto>;
  create(input: CreateExpenseDto): Promise<ExpenseDto>;
  update(id: string, input: CreateExpenseDto): Promise<ExpenseDto>;
  remove(id: string): Promise<void>;
}
