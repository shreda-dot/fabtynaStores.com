import {
  createExpenseDtoSchema,
  fromAuditLogDto,
  toAuditLogDto,
  toExpenseDto,
  type CreateExpenseDto,
  type Expense,
  type ExpenseDto,
} from "@fabtyna/shared";
import type { ExpensesApi, ExpenseListOptions } from "./expenses.api";
import { newId, readMockStore, transactMockStore } from "./mock-store";
import { mockDelay } from "./mock-transport";

function delay(): Promise<void> {
  return mockDelay();
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function response(expense: Expense): ExpenseDto {
  return jsonClone(toExpenseDto(expense));
}

function validated(input: CreateExpenseDto): CreateExpenseDto {
  return createExpenseDtoSchema.parse(input);
}

function findExpense(expenses: Expense[], id: string): Expense {
  const expense = expenses.find((item) => item.id === id);
  if (!expense) throw new Error("Expense not found.");
  return expense;
}

function audit(
  draft: ReturnType<typeof readMockStore>,
  action: string,
  expenseId: string,
  beforeData: unknown,
  afterData: unknown,
): void {
  draft.auditLogs.push(
    fromAuditLogDto(
      toAuditLogDto({
        id: newId(),
        actorId: null,
        action,
        entityType: "Expense",
        entityId: expenseId,
        beforeData,
        afterData,
        metadata: null,
        occurredAt: new Date(),
      }),
    ),
  );
}

function inRange(date: Date, from?: string, to?: string): boolean {
  if (from && date.getTime() < new Date(from).getTime()) return false;
  if (to && date.getTime() >= new Date(to).getTime()) return false;
  return true;
}

export const expensesMockApi: ExpensesApi = {
  async list(options: ExpenseListOptions = {}) {
    await delay();
    const rows = readMockStore().expenses
      .filter((expense) => {
        if (options.category && expense.category !== options.category) return false;
        if (options.channel && expense.channel !== options.channel) return false;
        if (!inRange(expense.expenseDate, options.from, options.to)) return false;
        return true;
      })
      .sort((a, b) => b.expenseDate.getTime() - a.expenseDate.getTime());
    return jsonClone(rows.map(toExpenseDto));
  },

  async getById(id) {
    await delay();
    return response(findExpense(readMockStore().expenses, id));
  },

  async create(input) {
    await delay();
    const data = validated(input);
    const result = transactMockStore((draft) => {
      const createdAt = new Date();
      const expense: Expense = {
        id: newId(),
        channel: data.channel,
        category: data.category,
        description: data.description.trim(),
        amountKobo: BigInt(data.amountKobo),
        expenseDate: new Date(data.expenseDate),
        createdAt,
        updatedAt: createdAt,
      };
      draft.expenses.push(expense);
      audit(draft, "EXPENSE_CREATED", expense.id, null, toExpenseDto(expense));
      return expense;
    });
    return response(result);
  },

  async update(id, input) {
    await delay();
    const data = validated(input);
    const result = transactMockStore((draft) => {
      const expense = findExpense(draft.expenses, id);
      const before = toExpenseDto(expense);
      Object.assign(expense, {
        channel: data.channel,
        category: data.category,
        description: data.description.trim(),
        amountKobo: BigInt(data.amountKobo),
        expenseDate: new Date(data.expenseDate),
        updatedAt: new Date(),
      });
      audit(draft, "EXPENSE_UPDATED", id, before, toExpenseDto(expense));
      return expense;
    });
    return response(result);
  },

  async remove(id) {
    await delay();
    transactMockStore((draft) => {
      const expense = findExpense(draft.expenses, id);
      const before = toExpenseDto(expense);
      draft.expenses = draft.expenses.filter((item) => item.id !== id);
      audit(draft, "EXPENSE_DELETED", id, before, null);
    });
  },
};
