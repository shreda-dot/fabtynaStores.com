// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrawingItem, DrawingList } from "@/lib/api/family-support.api";
import { DrawingHistory, historyDate } from "./drawing-history";

afterEach(cleanup);

function row(id: string, changes: Partial<DrawingItem> = {}): DrawingItem {
  return {
    id, entryId: `entry-${id}`, beneficiaryId: "member", beneficiaryName: "Dad",
    purpose: "SCHOOL_FEES", accountId: "account", accountName: "Cash",
    amountKobo: "1000", occurredAt: "2026-11-09T23:30:00Z",
    postedAt: "2026-11-09T21:00:00Z", note: null, reversed: false, sourceExpenseId: null,
    ...changes,
  };
}

function data(items: DrawingItem[]): DrawingList {
  return {
    items,
    report: {
      count: 30, totalKobo: "30000",
      byBeneficiary: [
        { id: "small", name: "Small", amountKobo: "10", count: 1, byPurpose: [] },
        { id: "large", name: "Large", amountKobo: "9007199254740993", count: 1, byPurpose: [] },
        { id: "second", name: "Second", amountKobo: "9007199254740992", count: 1, byPurpose: [] },
      ],
      byPurpose: [
        { id: "PERSONAL", name: "PERSONAL", amountKobo: "1", count: 1 },
        { id: "MEDICAL", name: "MEDICAL", amountKobo: "20", count: 1 },
      ],
      byAccount: [
        { id: "bank", name: "Bank", amountKobo: "1", count: 1 },
        { id: "cash", name: "Cash", amountKobo: "20", count: 1 },
      ],
    },
  };
}

describe("Drawing history display", () => {
  it("uses Lagos time in abbreviated dates across midnight", () => {
    expect(historyDate("2026-11-09T22:59:59Z")).toBe("9 Nov 2026");
    expect(historyDate("2026-11-09T23:00:00Z")).toBe("10 Nov 2026");
  });

  it("renders responsive rows, suppresses system notes and never offers reclassified reversal", () => {
    const reverse = vi.fn();
    render(<DrawingHistory data={data([
      row("moved", { sourceExpenseId: "expense", note: "Reclassified expense: Original description" }),
      row("unknown", { sourceExpenseId: "other", note: "unknown system text" }),
      row("default", { note: "Owner drawing: SCHOOL FEES" }),
      row("custom", { note: "A personal note" }),
      row("reversed", { reversed: true }),
    ])} pending={false} onReverse={reverse} />);

    const table = screen.getByRole("table");
    expect(table.parentElement?.className).toContain("hidden");
    expect(table.parentElement?.className).toContain("overflow-auto");
    expect(table.className).toContain("table-fixed");
    expect(table.className).toContain("min-w-[850px]");
    expect(Array.from(table.querySelectorAll("th"), (cell) => cell.textContent)).toEqual([
      "Date", "Beneficiary", "Purpose", "Account", "Amount", "Status", "Action",
    ]);
    expect(table.querySelector("thead")?.className).toContain("sticky");
    const desktopRows = within(table).getAllByRole("row");
    const moved = within(desktopRows[1]);
    expect(moved.getByText("10 Nov 2026")).toBeTruthy();
    expect(moved.getByText("Reclassified from expense")).toBeTruthy();
    expect(moved.getByText("Original description")).toBeTruthy();
    expect(moved.getByText("posted 9 Nov 2026")).toBeTruthy();
    expect(moved.getByText("Dad").getAttribute("title")).toBe("Dad");
    expect(moved.getByText("School fees").getAttribute("title")).toBe("School fees");
    expect(moved.getByText("Cash").getAttribute("title")).toBe("Cash");
    expect(desktopRows[1].querySelectorAll("td")[4].className).toContain("text-right");
    expect(moved.queryByRole("button", { name: "Reverse" })).toBeNull();
    expect(screen.getByText("Reclassified drawings cannot be reversed here.")).toBeTruthy();
    expect(within(desktopRows[2]).getByText("Original expense description unavailable.")).toBeTruthy();
    expect(within(desktopRows[3]).queryByText("Owner drawing: SCHOOL FEES")).toBeNull();
    expect(within(desktopRows[4]).getByText("A personal note")).toBeTruthy();
    expect(within(desktopRows[5]).getByText("Reversed")).toBeTruthy();
    expect(within(desktopRows[5]).queryByRole("button", { name: "Reverse" })).toBeNull();
    expect(desktopRows[5].className).toContain("text-muted-foreground");
    fireEvent.click(within(desktopRows[3]).getByRole("button", { name: "Reverse" }));
    expect(reverse).toHaveBeenCalledOnce();
    expect(reverse).toHaveBeenCalledWith("default");
    const mobile = screen.getByRole("list");
    expect(mobile.className).toContain("md:hidden");
    expect(within(mobile).getAllByText("Reclassified from expense")).toHaveLength(2);
    expect(within(mobile).getAllByText("Beneficiary:")).toHaveLength(5);
  });

  it("sorts all totals by exact kobo and shows more rows without changing totals", () => {
    const items = Array.from({ length: 30 }, (_, i) => row(String(i), { beneficiaryName: `Person ${i}` }));
    render(<DrawingHistory data={data(items)} pending={false} onReverse={vi.fn()} />);
    const beneficiary = screen.getByRole("heading", { name: "By beneficiary" }).closest("section");
    const purpose = screen.getByRole("heading", { name: "By purpose" }).closest("section");
    const account = screen.getByRole("heading", { name: "By account" }).closest("section");
    expect(Array.from(beneficiary!.querySelectorAll("dt"), (item) => item.textContent)).toEqual(["Large", "Second", "Small"]);
    expect(Array.from(purpose!.querySelectorAll("dt"), (item) => item.textContent)).toEqual(["Medical", "Personal"]);
    expect(Array.from(account!.querySelectorAll("dt"), (item) => item.textContent)).toEqual(["Cash", "Bank"]);
    expect(screen.getByText("(30 drawings)")).toBeTruthy();
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(26);
    fireEvent.click(screen.getByRole("button", { name: "Show more (5 remaining)" }));
    expect(within(table).getAllByRole("row")).toHaveLength(31);
    expect(screen.getByText("(30 drawings)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Show more/ })).toBeNull();
  }, 30000);
});
