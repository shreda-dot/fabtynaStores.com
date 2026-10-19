import {
  createExpenseDtoSchema,
  fromAuditLogDto,
  assertAccountAcceptsNewEntries,
  assertAccountWillRemainNonnegative,
  assertNotFutureOccurredAt,
  buildAccountLedgerEntry,
  getLagosBusinessDate,
  toAccountLedgerEntryDto,
  toAuditLogDto,
  toExpenseDto,
  type CreateExpenseDto,
  type Expense,
  type ExpenseDto,
  type AccountLedgerEntry,
} from "@fabtyna/shared";
import type { ExpensesApi, ExpenseListOptions } from "./expenses.api";
import {
  newId,
  readMockStore,
  transactMockStore,
} from "./mock-store";
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
        loanRepaymentId: null,
        voidedAt: null,
        voidReason: null,
        createdAt,
        updatedAt: createdAt,
      };
      assertNotFutureOccurredAt(expense.expenseDate, getLagosBusinessDate());
      let accountLedgerEntry: AccountLedgerEntry | null = null;
      if (expense.category !== "LOAN_INTEREST") {
        const accountId = data.accountId;
        if (!accountId) {
          throw new RangeError("Choose the account the expense will be paid from.");
        }
        const account = draft.accounts.find((item) => item.id === accountId);
        if (!account) throw new Error("Account not found.");
        assertAccountAcceptsNewEntries(account, false);
        const balanceKobo = draft.accountLedgerEntries
          .filter((entry) => entry.accountId === account.id)
          .reduce((total, entry) => total + entry.amountKobo, 0n);
        assertAccountWillRemainNonnegative(account, balanceKobo, -expense.amountKobo);
        accountLedgerEntry = buildAccountLedgerEntry(
          {
            accountId: account.id,
            type: "EXPENSE",
            amountKobo: -expense.amountKobo,
            expenseId: expense.id,
            occurredAt: expense.expenseDate,
            note: expense.description,
          },
          newId,
        );
      }
      draft.expenses.push(expense);
      if (accountLedgerEntry) {
        draft.accountLedgerEntries.push(accountLedgerEntry);
      }
      audit(draft, "EXPENSE_CREATED", expense.id, null, toExpenseDto(expense));
      return expense;
    });
    return response(result);
  },

  async void(id, reason) {
    await delay();
    const normalizedReason = reason.trim();
    if (normalizedReason === "") {
      throw new RangeError("Enter a reason for voiding this expense.");
    }
    const result = transactMockStore((draft) => {
      const expense = findExpense(draft.expenses, id);
      if (expense.voidedAt !== null) {
        throw new RangeError("This expense has already been voided.");
      }
      if (expense.loanRepaymentId !== null) {
        throw new RangeError(
          "A loan-interest expense cannot be voided separately from its repayment.",
        );
      }
      const before = toExpenseDto(expense);
      const accountEntry = draft.accountLedgerEntries.find(
        (entry) =>
          entry.expenseId === expense.id && entry.reversesEntryId === null,
      );
      if (accountEntry) {
        const account = draft.accounts.find(
          (item) => item.id === accountEntry.accountId,
        );
        if (!account) throw new Error("Account not found.");
        assertAccountAcceptsNewEntries(account, true);
        const balanceKobo = draft.accountLedgerEntries
          .filter((entry) => entry.accountId === account.id)
          .reduce((total, entry) => total + entry.amountKobo, 0n);
        assertAccountWillRemainNonnegative(
          account,
          balanceKobo,
          -accountEntry.amountKobo,
        );
        draft.accountLedgerEntries.push({
          ...accountEntry,
          id: newId(),
          amountKobo: -accountEntry.amountKobo,
          reversesEntryId: accountEntry.id,
          occurredAt: new Date(),
        });
      }
      const voidedAt = new Date();
      expense.voidedAt = voidedAt;
      expense.voidReason = normalizedReason;
      expense.updatedAt = voidedAt;
      audit(draft, "EXPENSE_VOIDED", id, before, toExpenseDto(expense));
      if (accountEntry) {
        audit(
          draft,
          "EXPENSE_ACCOUNT_ENTRY_REVERSED",
          accountEntry.id,
          toAccountLedgerEntryDto(accountEntry),
          {
            ...toAccountLedgerEntryDto(accountEntry),
            amountKobo: (-accountEntry.amountKobo).toString(),
            reversesEntryId: accountEntry.id,
          },
        );
      }
      return expense;
    });
    return response(result);
  },
};
