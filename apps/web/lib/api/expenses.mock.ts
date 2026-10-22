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
  type AccountLedgerEntry,
} from "@fabtyna/shared";
import type { ExpensesApi, ExpenseListOptions } from "./expenses.api";
import type {
  CreateExpenseInput,
  ExpenseCategoryDto,
  ExpenseRecordDto,
} from "./expenses.api";
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

const CATEGORY_NAMES: Record<string, string> = {
  RENT: "Rent",
  UTILITY: "Utility",
  SALARY: "Salary",
  TRANSPORT: "Transport",
  MAINTENANCE: "Maintenance",
  SUPPLIES: "Supplies",
  MARKETING: "Marketing",
  LOAN_INTEREST: "Loan interest",
  OTHER: "Other",
};

function record(expense: Expense): ExpenseRecordDto {
  const store = readMockStore();
  const entry = store.accountLedgerEntries.find(
    (row) => row.expenseId === expense.id && row.reversesEntryId === null,
  );
  return {
    id: expense.id,
    categoryId: expense.category,
    categoryName: CATEGORY_NAMES[expense.category] ?? expense.category,
    accountId: entry?.accountId ?? "",
    accountName:
      store.accounts.find((account) => account.id === entry?.accountId)?.name ?? "",
    channel: expense.channel,
    description: expense.description,
    amountKobo: expense.amountKobo.toString(),
    expenseDate: expense.expenseDate.toISOString(),
    voided: expense.voidedAt !== null,
    voidedAt: expense.voidedAt?.toISOString() ?? null,
    voidReason: expense.voidReason,
  };
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
  const businessDate = getLagosBusinessDate(date);
  if (from && businessDate < from) return false;
  if (to && businessDate > to) return false;
  return true;
}

export const expensesMockApi: ExpensesApi = {
  async list(options: ExpenseListOptions = {}) {
    await delay();
    const rows = readMockStore().expenses
      .filter((expense) => {
        if (options.categoryId && expense.category !== options.categoryId) return false;
        if (options.channel && expense.channel !== options.channel) return false;
        if (!options.includeVoided && expense.voidedAt !== null) return false;
        if (!inRange(expense.expenseDate, options.from, options.to)) return false;
        return true;
      })
      .sort((a, b) => b.expenseDate.getTime() - a.expenseDate.getTime());
    return jsonClone(rows.map(record));
  },

  async listPage(options = {}) {
    const items = await expensesMockApi.list(options);
    return { items, nextCursor: null, from: options.from ?? null, to: options.to ?? null };
  },

  async summary(options = {}) {
    const rows = (await expensesMockApi.list({ ...options, includeVoided: false }));
    const byCategory = new Map<string, { id: string; name: string; total: bigint; count: number }>();
    let total = 0n;
    for (const row of rows) {
      let amount = BigInt(row.amountKobo);
      if (options.channel && row.channel === "BOTH") {
        amount = options.channel === "RETAIL" ? amount / 2n : amount - amount / 2n;
      }
      total += amount;
      const current = byCategory.get(row.categoryId) ?? {
        id: row.categoryId,
        name: row.categoryName,
        total: 0n,
        count: 0,
      };
      current.total += amount;
      current.count += 1;
      byCategory.set(row.categoryId, current);
    }
    return {
      from: options.from ?? null,
      to: options.to ?? null,
      totalKobo: total.toString(),
      count: rows.length,
      byCategory: [...byCategory.values()].map((row) => ({
        id: row.id,
        name: row.name,
        totalKobo: row.total.toString(),
        count: row.count,
      })),
    };
  },

  async create(input: CreateExpenseInput) {
    await delay();
    const data = validated({
      ...input,
      category: input.categoryId as CreateExpenseDto["category"],
    });
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
    return record(result);
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
          "Loan interest expenses are created automatically by a repayment and cannot be voided. Loan repayment reversal is not available yet.",
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
    return record(result);
  },

  async amend(id, input) {
    const original = record(findExpense(readMockStore().expenses, id));
    await expensesMockApi.void(id, "Amended and recreated");
    return {
      expense: await expensesMockApi.create(input),
      voidedExpenseId: original.id,
    };
  },

  async listCategories(): Promise<ExpenseCategoryDto[]> {
    return Object.entries(CATEGORY_NAMES).map(([code, name]) => ({
      id: code,
      name,
      code,
      isActive: true,
      createdAt: new Date(0).toISOString(),
      expenseCount: 0,
    }));
  },
};
