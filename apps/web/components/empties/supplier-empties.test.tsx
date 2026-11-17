// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { emptiesApi } from "@/lib/api";
import { SupplierEmpties } from "./supplier-empties";

vi.mock("@/lib/api", () => ({
  isMockApiMode: false,
  emptiesApi: {
    listSupplierDebts: vi.fn(),
    listSupplierSettlements: vi.fn(),
    listTypes: vi.fn(),
    listBalances: vi.fn(),
    settleSupplierDebt: vi.fn(),
    createOpeningSupplierDebt: vi.fn(),
    reverseSupplierSettlement: vi.fn(),
  },
  suppliersApi: { list: vi.fn() },
}));

afterEach(cleanup);

it("shows a separate supplier empties balance and records a partial return", async () => {
  vi.mocked(emptiesApi.listSupplierDebts).mockResolvedValue({
    items: [{
      id: "obligation-1",
      supplierId: "supplier-1",
      supplierName: "Brewery",
      typeId: "crate-type",
      ownerName: "Brewery",
      kind: "CRATE",
      typeLabel: "IB crates",
      purchaseId: "purchase-1",
      purchaseReference: "P-100",
      originalQuantity: 5,
      quantity: 5,
      createdAt: "2026-01-01T00:00:00.000Z",
    }],
    nextCursor: null,
  });
  vi.mocked(emptiesApi.listSupplierSettlements).mockResolvedValue({ items: [], nextCursor: null });
  vi.mocked(emptiesApi.listTypes).mockResolvedValue([]);
  vi.mocked(emptiesApi.listBalances).mockResolvedValue({
    items: [{
      typeId: "crate-type",
      ownerId: "owner-1",
      ownerName: "Brewery",
      kind: "CRATE",
      label: "IB crates",
      capacity: null,
      unitValueKobo: null,
      quantity: 4,
      valueKobo: null,
    }],
    totalsByOwner: [],
    totalsByKind: [],
  });
  let resolveReturn!: (value: object) => void;
  vi.mocked(emptiesApi.settleSupplierDebt).mockImplementation(() => new Promise((resolve) => {
    resolveReturn = resolve;
  }));

  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SupplierEmpties supplierId="supplier-1" supplierName="Brewery" />
    </QueryClientProvider>,
  );

  expect(await screen.findByText(/Owed: 5 empty crates/)).toBeTruthy();
  expect(screen.getByText(/Originally owed: 5 empty crates/)).toBeTruthy();
  expect(screen.getByText(/On hand: 4 empty crates/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Empties returned"), { target: { value: "2" } });
  const button = screen.getByRole("button", { name: "Record return" });
  fireEvent.click(button);
  await waitFor(() => expect(button.getAttribute("aria-busy")).toBe("true"));
  expect(button).toHaveProperty("disabled", true);
  await waitFor(() => expect(emptiesApi.settleSupplierDebt).toHaveBeenCalledWith(
    { supplierId: "supplier-1", typeId: "crate-type", quantity: 2 },
    expect.any(String),
  ));
  await act(async () => resolveReturn({}));
});
