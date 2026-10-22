import { requestJson } from "./client";
import type {
  CreateExpenseInput,
  ExpenseAmendResultDto,
  ExpenseCategoryDto,
  ExpenseListOptions,
  ExpenseListPageDto,
  ExpenseRecordDto,
  ExpenseSummaryDto,
  ExpensesApi,
} from "./expenses.api";

function query(values: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") params.set(name, value);
  }
  const result = params.toString();
  return result ? `?${result}` : "";
}

function listQuery(options: ExpenseListOptions & { cursor?: string; limit?: number }): string {
  return query({
    from: options.from,
    to: options.to,
    categoryId: options.categoryId,
    channel: options.channel,
    includeVoided: options.includeVoided ? "true" : undefined,
    cursor: options.cursor,
    limit: String(options.limit ?? 50),
  });
}

async function listPage(
  options: ExpenseListOptions & { cursor?: string; limit?: number } = {},
): Promise<ExpenseListPageDto> {
  return requestJson<ExpenseListPageDto>(`/expenses${listQuery(options)}`);
}

export const expensesRealApi: ExpensesApi = {
  listPage,

  async list(options = {}) {
    const items: ExpenseRecordDto[] = [];
    let cursor: string | undefined;
    do {
      const page = await listPage({ ...options, cursor, limit: 200 });
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return items;
  },

  async summary(options = {}) {
    return requestJson<ExpenseSummaryDto>(
      `/expenses/summary${query({
        from: options.from,
        to: options.to,
        categoryId: options.categoryId,
        channel: options.channel === "BOTH" ? undefined : options.channel,
      })}`,
    );
  },

  async create(input: CreateExpenseInput, idempotencyKey) {
    return requestJson<ExpenseRecordDto>("/expenses", {
      method: "POST",
      body: input,
      idempotencyKey,
    });
  },

  async void(id, reason, idempotencyKey) {
    return requestJson<ExpenseRecordDto>(`/expenses/${encodeURIComponent(id)}/void`, {
      method: "POST",
      body: { reason },
      idempotencyKey,
    });
  },

  async amend(id, input, idempotencyKey): Promise<ExpenseAmendResultDto> {
    return requestJson<ExpenseAmendResultDto>(`/expenses/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: input,
      idempotencyKey,
    });
  },

  async listCategories(includeInactive = false) {
    return requestJson<ExpenseCategoryDto[]>(
      `/expense-categories?includeInactive=${includeInactive ? "true" : "false"}`,
    );
  },

  async createCategory(name, idempotencyKey) {
    return requestJson<ExpenseCategoryDto>("/expense-categories", {
      method: "POST",
      body: { name },
      idempotencyKey,
    });
  },

  async renameCategory(id, name, idempotencyKey) {
    return requestJson<ExpenseCategoryDto>(`/expense-categories/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { name },
      idempotencyKey,
    });
  },

  async setCategoryActive(id, isActive, idempotencyKey) {
    return requestJson<ExpenseCategoryDto>(
      `/expense-categories/${encodeURIComponent(id)}/${isActive ? "reactivate" : "deactivate"}`,
      { method: "POST", idempotencyKey },
    );
  },
};
