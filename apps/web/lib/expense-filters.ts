import { validateReportRange } from "./report-range";
import type {
  ExpenseCategoryDto,
  ExpenseListPageDto,
  ExpenseRecordDto,
  ExpenseSummaryDto,
} from "./api/expenses.api";

export type RangePreset = { label: string; from: string; to: string };

const DAY_MS = 86_400_000;

/** Pure YYYY-MM-DD arithmetic (UTC calendar math, so the device timezone never matters). */
export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Presets relative to the Lagos business date. "This week" starts on Monday.
 * "Last 30 days" is 30 inclusive days ending today.
 */
export function expenseRangePresets(businessDate: string): RangePreset[] {
  const dayOfWeek = new Date(`${businessDate}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const sinceMonday = (dayOfWeek + 6) % 7;
  const yesterday = shiftDate(businessDate, -1);
  return [
    { label: "Today", from: businessDate, to: businessDate },
    { label: "Yesterday", from: yesterday, to: yesterday },
    { label: "This week", from: shiftDate(businessDate, -sinceMonday), to: businessDate },
    { label: "This month", from: `${businessDate.slice(0, 7)}-01`, to: businessDate },
    { label: "Last 30 days", from: shiftDate(businessDate, -29), to: businessDate },
  ];
}

/** Same rules as the API (order, 366 inclusive days) plus: no future dates. */
export function validateExpenseRange(from: string, to: string, businessDate: string): string | null {
  const base = validateReportRange(from, to);
  if (base !== null) return base;
  if (to > businessDate || from > businessDate) return "Dates cannot be in the future.";
  return null;
}

/** Appends pages in order and drops any id already seen (a row can move between pages after a write). */
export function mergeExpensePages(pages: readonly ExpenseListPageDto[]): ExpenseRecordDto[] {
  const seen = new Set<string>();
  const merged: ExpenseRecordDto[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
  }
  return merged;
}

/** Largest first, then name. Amounts compare as bigint; nothing is summed or converted here. */
export function orderCategoryTotals(
  rows: ExpenseSummaryDto["byCategory"],
): ExpenseSummaryDto["byCategory"] {
  return [...rows].sort((a, b) => {
    const left = BigInt(a.totalKobo);
    const right = BigInt(b.totalKobo);
    if (left !== right) return left > right ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export type CategoryStatusFilter = "ACTIVE" | "INACTIVE" | "ALL";

export function filterCategories(
  categories: readonly ExpenseCategoryDto[],
  options: { search: string; status: CategoryStatusFilter; limit: number },
): { items: ExpenseCategoryDto[]; total: number } {
  const needle = options.search.trim().toLowerCase();
  const matches = categories
    .filter((category) => {
      if (options.status === "ACTIVE" && !category.isActive) return false;
      if (options.status === "INACTIVE" && category.isActive) return false;
      return needle === "" || category.name.toLowerCase().includes(needle);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { items: matches.slice(0, options.limit), total: matches.length };
}

/** Categories the new-expense and amend forms may use: active, not system-managed, by name. */
export function selectableCategories(categories: readonly ExpenseCategoryDto[]): ExpenseCategoryDto[] {
  return categories
    .filter((category) => category.isActive && category.code !== "LOAN_INTEREST")
    .sort((a, b) => a.name.localeCompare(b.name));
}
