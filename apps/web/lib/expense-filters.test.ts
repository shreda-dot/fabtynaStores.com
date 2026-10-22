import { describe, expect, it } from "vitest";
import type {
  ExpenseCategoryDto,
  ExpenseListPageDto,
  ExpenseRecordDto,
  ExpenseSummaryDto,
} from "./api/expenses.api";
import {
  expenseRangePresets,
  filterCategories,
  mergeExpensePages,
  orderCategoryTotals,
  selectableCategories,
  shiftDate,
  validateExpenseRange,
} from "./expense-filters";

const TODAY = "2026-10-21"; // a Wednesday (2026-01-01 is a Thursday; day 294 is 293 days later, 293 mod 7 = 6)

describe("validateExpenseRange", () => {
  it("accepts exactly 366 inclusive days (2024 is a leap year: Jan 1 to Dec 31)", () => {
    expect(validateExpenseRange("2024-01-01", "2024-12-31", TODAY)).toBeNull();
  });

  it("rejects 367 inclusive days", () => {
    expect(validateExpenseRange("2024-01-01", "2025-01-01", TODAY)).toMatch(/366/);
  });

  it("rejects from after to", () => {
    expect(validateExpenseRange("2026-10-02", "2026-10-01", TODAY)).toMatch(/must not be after/);
  });

  it("rejects a future date but accepts today", () => {
    expect(validateExpenseRange("2026-10-21", "2026-10-22", TODAY)).toMatch(/future/);
    expect(validateExpenseRange("2026-10-21", "2026-10-21", TODAY)).toBeNull();
  });

  it("rejects text that is not a date", () => {
    expect(validateExpenseRange("", "2026-10-01", TODAY)).toMatch(/valid date range/);
  });
});

describe("expenseRangePresets (Lagos business date, Monday week start)", () => {
  const byLabel = (date: string) =>
    Object.fromEntries(expenseRangePresets(date).map((p) => [p.label, [p.from, p.to]]));

  it("on Wednesday 2026-10-21", () => {
    const p = byLabel(TODAY);
    expect(p["Today"]).toEqual(["2026-10-21", "2026-10-21"]);
    expect(p["Yesterday"]).toEqual(["2026-10-20", "2026-10-20"]);
    // Monday of that week is 2026-10-19.
    expect(p["This week"]).toEqual(["2026-10-19", "2026-10-21"]);
    expect(p["This month"]).toEqual(["2026-10-01", "2026-10-21"]);
    // 30 inclusive days: Oct 21 back 29 days = Sep 22 (Oct 1 is -20, Sep 30 is -21, Sep 22 is -29).
    expect(p["Last 30 days"]).toEqual(["2026-09-22", "2026-10-21"]);
  });

  it("on Sunday 2026-10-25 the week still starts on Monday 2026-10-19", () => {
    expect(byLabel("2026-10-25")["This week"]).toEqual(["2026-10-19", "2026-10-25"]);
  });

  it("on Sunday 2026-03-01 the week starts in February (Mar 1 minus 6 = Feb 23)", () => {
    const p = byLabel("2026-03-01");
    expect(p["This week"]).toEqual(["2026-02-23", "2026-03-01"]);
    expect(p["Yesterday"]).toEqual(["2026-02-28", "2026-02-28"]);
  });

  it("every preset passes validation", () => {
    for (const preset of expenseRangePresets(TODAY)) {
      expect(validateExpenseRange(preset.from, preset.to, TODAY)).toBeNull();
    }
  });

  it("shiftDate crosses a leap day", () => {
    expect(shiftDate("2024-03-01", -1)).toBe("2024-02-29");
  });
});

function expense(id: string): ExpenseRecordDto {
  return { id } as ExpenseRecordDto;
}

describe("mergeExpensePages", () => {
  it("keeps order and drops ids repeated across pages", () => {
    const pages: ExpenseListPageDto[] = [
      { items: [expense("a"), expense("b")], nextCursor: "c1", from: null, to: null },
      { items: [expense("b"), expense("c")], nextCursor: "c2", from: null, to: null },
      { items: [expense("c"), expense("d")], nextCursor: null, from: null, to: null },
    ];
    // a, b, (b dup), c, (c dup), d
    expect(mergeExpensePages(pages).map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("handles no pages", () => {
    expect(mergeExpensePages([])).toEqual([]);
  });
});

describe("orderCategoryTotals", () => {
  // API-shaped fixture. Rent holds a BOTH expense of an odd 10001 kobo recorded in full
  // (the API only splits BOTH when a channel is requested). Loan interest is an ordinary row.
  const fixture: ExpenseSummaryDto["byCategory"] = [
    { id: "c-loan", name: "Loan interest", totalKobo: "2500", count: 1 },
    { id: "c-rent", name: "Rent", totalKobo: "10001", count: 2 },
    { id: "c-fuel", name: "Fuel", totalKobo: "2500", count: 3 },
    { id: "c-big", name: "Big", totalKobo: "9007199254740993", count: 1 },
    { id: "c-big2", name: "Big2", totalKobo: "9007199254740992", count: 1 },
  ];

  it("sorts by amount descending, ties by name, without losing precision", () => {
    // ...993 > ...992 (equal as floats, so this proves bigint compare) > 10001 > Fuel 2500 = Loan 2500 (Fuel first by name)
    expect(orderCategoryTotals(fixture).map((r) => r.id)).toEqual([
      "c-big",
      "c-big2",
      "c-rent",
      "c-fuel",
      "c-loan",
    ]);
  });

  it("does not mutate its input and keeps the odd-kobo amount as given", () => {
    const copy = JSON.stringify(fixture);
    const ordered = orderCategoryTotals(fixture);
    expect(JSON.stringify(fixture)).toBe(copy);
    expect(ordered.find((r) => r.id === "c-rent")?.totalKobo).toBe("10001");
  });
});

function category(
  name: string,
  overrides: Partial<ExpenseCategoryDto> = {},
): ExpenseCategoryDto {
  return {
    id: name,
    name,
    code: null,
    isActive: true,
    createdAt: "",
    expenseCount: 0,
    ...overrides,
  };
}

describe("filterCategories", () => {
  const all: ExpenseCategoryDto[] = [
    ...Array.from({ length: 25 }, (_, i) => category(`ZZTEST ${String(i + 1).padStart(2, "0")}`)),
    category("Old rent", { isActive: false }),
    category("Loan interest", { code: "LOAN_INTEREST" }),
  ];

  it("shows 20 first and reports the full total (27 categories)", () => {
    const result = filterCategories(all, { search: "", status: "ALL", limit: 20 });
    expect(result.items).toHaveLength(20);
    expect(result.total).toBe(27);
  });

  it("show 20 more reaches the end (limit 40 returns all 27)", () => {
    expect(filterCategories(all, { search: "", status: "ALL", limit: 40 }).items).toHaveLength(27);
  });

  it("searches case-insensitively: 'zztest 2' matches 20..25 plus 02? no - only names containing it", () => {
    // Names containing "zztest 2": 20, 21, 22, 23, 24, 25 = 6.
    expect(filterCategories(all, { search: "zztest 2", status: "ALL", limit: 20 }).total).toBe(6);
  });

  it("filters inactive only and active only", () => {
    expect(filterCategories(all, { search: "", status: "INACTIVE", limit: 20 }).items.map((c) => c.name)).toEqual([
      "Old rent",
    ]);
    // 25 ZZTEST + Loan interest = 26 active.
    expect(filterCategories(all, { search: "", status: "ACTIVE", limit: 50 }).total).toBe(26);
  });
});

describe("selectableCategories", () => {
  it("keeps active, non-LOAN_INTEREST categories sorted by name", () => {
    const result = selectableCategories([
      category("Zebra"),
      category("Old", { isActive: false }),
      category("Loan interest", { code: "LOAN_INTEREST" }),
      category("Apple"),
    ]);
    expect(result.map((c) => c.name)).toEqual(["Apple", "Zebra"]);
  });
});
