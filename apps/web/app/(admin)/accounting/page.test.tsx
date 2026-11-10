// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { computeFinancialPosition, formatNaira } from "@fabtyna/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accountingApi } from "@/lib/api";
import type { AccountingPosition } from "@/lib/api/accounting.api";
import AccountingOverviewPage from "./page";

vi.mock("@/lib/api", () => ({
  accountingApi: {
    position: vi.fn(),
    listAccounts: vi.fn(),
    moneyFlow: vi.fn(),
  },
}));

afterEach(cleanup);

async function showPage(ownerWithdrawals: AccountingPosition["ownerWithdrawals"]) {
  vi.mocked(accountingApi.position).mockResolvedValue({
    ...computeFinancialPosition({
      todayLagosDate: "2026-11-09",
      products: [],
      receivablesKobo: 0n,
      cashKobo: 0n,
      supplierPayablesKobo: 0n,
      loansOutstandingKobo: 0n,
    }),
    ownerWithdrawals,
  });
  vi.mocked(accountingApi.listAccounts).mockResolvedValue([]);
  vi.mocked(accountingApi.moneyFlow).mockImplementation(() => new Promise(() => {}));

  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AccountingOverviewPage />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Cash and bank balances" });
}

describe("Accounting overview owner withdrawals", () => {
  it("shows all nonzero amounts in summary rows immediately after account balances", async () => {
    await showPage({ drawingsKobo: 1000n, legacyLoanKobo: 2000n, unclassifiedKobo: 3000n });

    const balances = screen.getByRole("heading", { name: "Cash and bank balances" }).closest("section");
    const card = screen.getByRole("heading", { name: "Owner withdrawals" }).closest("section");
    const flow = screen.getByRole("heading", { name: "Money flow" }).closest("section");
    expect(balances?.nextElementSibling).toBe(card);
    expect(card?.nextElementSibling).toBe(flow);
    expect(card).not.toBeNull();
    const contents = within(card!);
    expect(contents.getByText("All-time totals. Already included in the account balances above; not deducted again from net position.")).toBeTruthy();
    expect(contents.getByRole("link", { name: "See by period in Family Support" }).getAttribute("href")).toBe("/family-support");
    for (const [label, amount] of [
      ["Owner drawings", 1000n],
      ["Legacy loan repayment (to be reclassified)", 2000n],
      ["Unclassified legacy withdrawals", 3000n],
    ] as const) {
      const term = contents.getByText(label);
      expect(term.tagName).toBe("DT");
      expect(term.nextElementSibling?.tagName).toBe("DD");
      expect(term.nextElementSibling?.textContent).toBe(formatNaira(amount));
    }
  });

  it.each([
    [{ drawingsKobo: 1000n, legacyLoanKobo: 0n, unclassifiedKobo: 0n }, "Owner drawings"],
    [{ drawingsKobo: 0n, legacyLoanKobo: 2000n, unclassifiedKobo: 0n }, "Legacy loan repayment (to be reclassified)"],
    [{ drawingsKobo: 0n, legacyLoanKobo: 0n, unclassifiedKobo: 3000n }, "Unclassified legacy withdrawals"],
  ])("shows only the nonzero line for %o", async (totals, label) => {
    await showPage(totals);
    const card = screen.getByRole("heading", { name: "Owner withdrawals" }).closest("section");
    expect(card?.querySelectorAll("dt")).toHaveLength(1);
    expect(card?.querySelector("dt")?.textContent).toBe(label);
  });

  it.each([
    { drawingsKobo: 0n, legacyLoanKobo: 0n, unclassifiedKobo: 0n },
    { drawingsKobo: 0n, legacyLoanKobo: 0n, unclassifiedKobo: -100n },
  ])("hides the card when no line is eligible for display: %o", async (totals) => {
    await showPage(totals);
    expect(screen.queryByRole("heading", { name: "Owner withdrawals" })).toBeNull();
  });

  it("shows nonzero negative drawings and legacy loan amounts, but not negative unclassified amounts", async () => {
    await showPage({ drawingsKobo: -100n, legacyLoanKobo: -200n, unclassifiedKobo: -300n });
    const card = screen.getByRole("heading", { name: "Owner withdrawals" }).closest("section");
    expect(card?.querySelectorAll("dt")).toHaveLength(2);
    expect(within(card!).queryByText("Unclassified legacy withdrawals")).toBeNull();
  });
});
