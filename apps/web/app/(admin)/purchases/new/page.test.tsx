// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { accountingApi, productsApi, purchasesApi, suppliersApi } from "@/lib/api";
import type { PurchaseEmptiesPreviewDto } from "@/lib/api/empties.api";
import { confirm } from "@/stores/confirm-store";
import NewPurchasePage from "./page";

const mode = vi.hoisted(() => ({ demo: true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/stores/confirm-store", () => ({ confirm: vi.fn().mockResolvedValue(true) }));
vi.mock("@/hooks/use-debounced-value", () => ({ useDebouncedValue: <T,>(value: T) => value }));
vi.mock("@/lib/api", () => ({
  get isMockApiMode() { return mode.demo; },
  purchasesApi: { previewEmpties: vi.fn(), create: vi.fn() },
  productsApi: { list: vi.fn() },
  suppliersApi: { list: vi.fn() },
  accountingApi: { listPaymentAccounts: vi.fn() },
}));

afterEach(() => {
  cleanup();
  mode.demo = true;
  vi.clearAllMocks();
});

it("warns that demo purchases do not enforce empties rules", () => {
  vi.mocked(productsApi.list).mockResolvedValue([]);
  vi.mocked(suppliersApi.list).mockResolvedValue([]);
  vi.mocked(accountingApi.listPaymentAccounts).mockResolvedValue([]);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NewPurchasePage />
    </QueryClientProvider>,
  );
  expect(screen.getByText("Demo purchases do not check or record supplier empties or empties debts.")).toBeTruthy();
}, 15_000);

it("accepts a cleared zero split and shows loading while checking before saving", async () => {
  mode.demo = false;
  vi.mocked(confirm).mockResolvedValue(true);
  vi.mocked(productsApi.list).mockResolvedValue([{
    id: "product-1", name: "Lager", sku: null, category: "BEER", packName: "crate",
    unitsPerPack: 24, saleChannel: "BOTH", retailPriceKobo: "0", wholesalePriceKobo: "0",
    averageCostKobo: "0", reorderLevelUnits: 0, deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  }]);
  vi.mocked(suppliersApi.list).mockResolvedValue([]);
  vi.mocked(accountingApi.listPaymentAccounts).mockResolvedValue([]);
  const preview: PurchaseEmptiesPreviewDto = {
    lines: [{ index: 0, requirements: [] }],
    totals: [{ typeId: "crate-type", kind: "CRATE", label: "Crates", required: 100, available: 22, shortage: 78 }],
  };
  vi.mocked(purchasesApi.previewEmpties).mockResolvedValue(preview);
  vi.mocked(purchasesApi.create).mockImplementation(async (input) => ({
    id: "purchase-1", supplierId: input.supplierId ?? null, createdById: "user-1",
    status: "RECEIVED", reference: "P-1", notes: null, totalKobo: "0", paidKobo: "0",
    dueDate: null, purchasedAt: input.purchasedAt, receivedAt: input.purchasedAt,
    createdAt: input.purchasedAt, updatedAt: input.purchasedAt,
    supplier: null, lines: [], movements: [], payments: [],
  }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NewPurchasePage />
    </QueryClientProvider>,
  );
  await screen.findByRole("option", { name: "Lager" }, { timeout: 10_000 });
  fireEvent.change(screen.getByLabelText("Product"), { target: { value: "product-1" } });
  fireEvent.change(screen.getByLabelText("Quantity (crates)"), { target: { value: "100" } });
  fireEvent.change(screen.getByLabelText("Price per pack"), { target: { value: "0" } });
  await screen.findByText("You have 22 empty crates. Buying 100. Short by 78.");
  fireEvent.change(screen.getByLabelText("I owe the supplier"), { target: { value: "" } });
  expect(screen.getByText("Together: 78 of 78.")).toBeTruthy();

  let resolvePreview!: (value: PurchaseEmptiesPreviewDto) => void;
  vi.mocked(purchasesApi.previewEmpties).mockImplementationOnce(() => new Promise((resolve) => { resolvePreview = resolve; }));
  const button = screen.getByRole("button", { name: "Receive purchase" });
  fireEvent.click(button);
  await waitFor(() => expect(button.getAttribute("aria-busy")).toBe("true"));
  expect(button).toHaveProperty("disabled", true);
  await act(async () => resolvePreview(preview));
  await waitFor(() => expect(confirm).toHaveBeenCalled());
  await waitFor(() => expect(purchasesApi.create).toHaveBeenCalledWith(
    expect.objectContaining({ emptiesResolutions: [{ typeId: "crate-type", suppliedFree: 78, owed: 0 }] }),
    expect.any(String),
  ));
}, 20_000);
