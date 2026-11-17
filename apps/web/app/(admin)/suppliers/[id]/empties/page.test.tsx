// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { suppliersApi } from "@/lib/api";
import SupplierDetailPage from "../page";
import SupplierEmptiesPage from "./page";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "supplier-1" }) }));
vi.mock("@/lib/api", () => ({
  suppliersApi: { getById: vi.fn(), getStatement: vi.fn() },
}));
vi.mock("@/components/empties/supplier-empties", () => ({
  SupplierEmpties: ({ supplierId, supplierName }: { supplierId: string; supplierName: string }) => (
    <div>Empties ledger for {supplierName} ({supplierId})</div>
  ),
}));

afterEach(cleanup);

function renderPage(page: React.ReactNode) {
  vi.mocked(suppliersApi.getById).mockResolvedValue({
    supplier: { id: "supplier-1", name: "Brewery", phone: null, email: null, address: null, notes: null, active: true },
    balanceOwedKobo: "0", unpaidPurchases: [], recentPurchases: [],
  });
  vi.mocked(suppliersApi.getStatement).mockResolvedValue({
    party: { id: "supplier-1", name: "Brewery" }, from: "2026-01-01", to: "2026-01-01",
    openingBalanceKobo: "0", closingBalanceKobo: "0", entries: [], nextCursor: null,
  });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{page}</QueryClientProvider>);
}

it("links from the supplier detail without displaying its full empties ledger", async () => {
  renderPage(<SupplierDetailPage />);
  expect((await screen.findByRole("link", { name: "View empties balance and history" })).getAttribute("href"))
    .toBe("/suppliers/supplier-1/empties");
  expect(screen.queryByText(/Empties ledger for/)).toBeNull();
});

it("opens the selected supplier's empties ledger with a link back", async () => {
  renderPage(<SupplierEmptiesPage />);
  expect(await screen.findByText("Empties ledger for Brewery (supplier-1)")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Back to supplier" }).getAttribute("href")).toBe("/suppliers/supplier-1");
});
