// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accountingApi, familySupportApi } from "@/lib/api";
import FamilySupportPage from "./page";

vi.mock("@/hooks/use-lagos-business-date", () => ({
  useLagosBusinessDate: () => "2026-03-01",
}));
vi.mock("@/lib/api", () => ({
  accountingApi: { listAccounts: vi.fn().mockResolvedValue([]) },
  familySupportApi: {
    listMembers: vi.fn().mockResolvedValue([]),
    reverseDrawing: vi.fn(),
    createDrawing: vi.fn(),
    listDrawings: vi.fn().mockResolvedValue({
      items: [],
      report: { totalKobo: "0", count: 0, byBeneficiary: [], byPurpose: [], byAccount: [] },
    }),
  },
}));

afterEach(cleanup);

describe("Family Support date controls", () => {
  it("uses inclusive presets, sends their ranges to the report and switches edits to Custom", async () => {
    vi.mocked(accountingApi.listAccounts).mockResolvedValue([]);
    vi.mocked(familySupportApi.listMembers).mockResolvedValue([]);
    vi.mocked(familySupportApi.listDrawings).mockResolvedValue({
      items: [],
      report: { totalKobo: "0", count: 0, byBeneficiary: [], byPurpose: [], byAccount: [] },
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FamilySupportPage />
      </QueryClientProvider>,
    );
    const section = screen.getByRole("heading", { name: "Drawing history and totals" }).closest("section");
    expect(section).not.toBeNull();
    const history = within(section!);
    const from = history.getByLabelText("From") as HTMLInputElement;
    const to = history.getByLabelText("To") as HTMLInputElement;
    await waitFor(() => expect(familySupportApi.listDrawings).toHaveBeenLastCalledWith({ from: "2026-03-01", to: "2026-03-01" }));
    expect(history.getByRole("button", { name: "This month" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(history.getByRole("button", { name: "Yesterday" }));
    await waitFor(() => expect(familySupportApi.listDrawings).toHaveBeenLastCalledWith({ from: "2026-02-28", to: "2026-02-28" }));
    expect(from.value).toBe("2026-02-28");
    expect(to.value).toBe("2026-02-28");
    expect(await history.findByText("Yesterday: 28 Feb 2026 to 28 Feb 2026 (Lagos dates)", {}, { timeout: 10000 })).toBeTruthy();

    fireEvent.click(history.getByRole("button", { name: "Last 14 days" }));
    await waitFor(() => expect(familySupportApi.listDrawings).toHaveBeenLastCalledWith({ from: "2026-02-16", to: "2026-03-01" }));
    fireEvent.click(history.getByRole("button", { name: "Last 30 days" }));
    await waitFor(() => expect(familySupportApi.listDrawings).toHaveBeenLastCalledWith({ from: "2026-01-31", to: "2026-03-01" }));
    fireEvent.change(from, { target: { value: "2026-02-01" } });
    await waitFor(() => expect(familySupportApi.listDrawings).toHaveBeenLastCalledWith({ from: "2026-02-01", to: "2026-03-01" }));
    expect(history.getByRole("button", { name: "Custom" }).getAttribute("aria-pressed")).toBe("true");
    expect(await history.findByText("Custom: 1 Feb 2026 to 1 Mar 2026 (Lagos dates)", {}, { timeout: 10000 })).toBeTruthy();

    fireEvent.click(history.getByRole("button", { name: "Today" }));
    expect(from.value).toBe("2026-03-01");
    expect(to.value).toBe("2026-03-01");
    fireEvent.click(history.getByRole("button", { name: "Custom" }));
    expect(from.value).toBe("2026-03-01");
    expect(to.value).toBe("2026-03-01");
  }, 30_000);

  it("keeps the normal reversal reason flow and opens the record form and beneficiary section", async () => {
    vi.mocked(accountingApi.listAccounts).mockResolvedValue([]);
    vi.mocked(familySupportApi.listMembers).mockResolvedValue([]);
    vi.mocked(familySupportApi.reverseDrawing).mockResolvedValue({ ok: true });
    vi.mocked(familySupportApi.listDrawings).mockResolvedValue({
      items: [{
        id: "ordinary", entryId: "entry", beneficiaryId: "member", beneficiaryName: "Dad",
        purpose: "MEDICAL", accountId: "cash", accountName: "Cash", amountKobo: "1000",
        occurredAt: "2026-03-01T10:00:00Z", postedAt: "2026-03-01T10:00:00Z",
        note: null, reversed: false, sourceExpenseId: null,
      }],
      report: { totalKobo: "1000", count: 1, byBeneficiary: [], byPurpose: [], byAccount: [] },
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FamilySupportPage />
      </QueryClientProvider>,
    );
    const table = await screen.findByRole("table", {}, { timeout: 10000 });
    fireEvent.click(within(table).getByRole("button", { name: "Reverse" }));
    const dialog = screen.getByRole("dialog", { name: "Reverse drawing" });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Correction" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reverse drawing" }));
    await waitFor(() => expect(familySupportApi.reverseDrawing).toHaveBeenCalledWith(
      "ordinary", "Correction", expect.any(String),
    ), { timeout: 10000 });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Reverse drawing" })).toBeNull(), { timeout: 10000 });
    fireEvent.click(screen.getByRole("button", { name: "Record a drawing" }));
    expect(screen.getByRole("dialog", { name: "Record a drawing" })).toBeTruthy();
    expect(screen.getByText("Manage beneficiaries").closest("details")).toBeTruthy();
  }, 30_000);
});
