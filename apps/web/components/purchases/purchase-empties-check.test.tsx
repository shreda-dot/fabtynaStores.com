// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ProductDto } from "@fabtyna/shared";
import { afterEach, expect, it, vi } from "vitest";
import { purchasesApi } from "@/lib/api";
import { parseEmptiesShortageResolution, PurchaseEmptiesCheck } from "./purchase-empties-check";

vi.mock("@/lib/api", () => ({
  isMockApiMode: false,
  purchasesApi: { previewEmpties: vi.fn() },
}));
vi.mock("@/hooks/use-debounced-value", () => ({
  useDebouncedValue: <T,>(value: T) => value,
}));

afterEach(cleanup);

const product: ProductDto = {
  id: "product-1",
  name: "Lager",
  sku: null,
  category: "BEER",
  packName: "crate",
  unitsPerPack: 24,
  saleChannel: "BOTH",
  retailPriceKobo: "0",
  wholesalePriceKobo: "0",
  averageCostKobo: "0",
  reorderLevelUnits: 0,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function renderCheck(onCrateCountChange = vi.fn(), onResolutionChange = vi.fn()) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PurchaseEmptiesCheck
        lines={[{ id: "line-1", productId: product.id, unit: "PACK", quantity: "1" }]}
        products={new Map([[product.id, product]])}
        supplierId="supplier-1"
        resolutions={{}}
        onCrateCountChange={onCrateCountChange}
        onResolutionChange={onResolutionChange}
      />
    </QueryClientProvider>,
  );
}

it("shows a calm shortfall and split free/debt fields that report the chosen amounts", async () => {
  vi.mocked(purchasesApi.previewEmpties).mockResolvedValue({
    lines: [{ index: 0, requirements: [] }],
    totals: [{
      typeId: "crate-type",
      kind: "CRATE",
      label: "IB crates",
      required: 80,
      available: 75,
      shortage: 5,
    }],
  });
  const onResolutionChange = vi.fn();
  renderCheck(vi.fn(), onResolutionChange);

  expect(await screen.findByText("You have 75 empty crates. Buying 80. Short by 5.")).toBeTruthy();
  expect(screen.getByLabelText("Supplier gave me free")).toHaveProperty("value", "5");
  expect(screen.getByLabelText("I owe the supplier")).toHaveProperty("value", "0");
  fireEvent.change(screen.getByLabelText("I owe the supplier"), { target: { value: "2" } });
  expect(onResolutionChange).toHaveBeenCalledWith("crate-type", { suppliedFree: "5", owed: "2" });
});

it("treats a cleared amount as zero, but rejects invalid or incomplete splits", () => {
  expect(parseEmptiesShortageResolution({ suppliedFree: "78", owed: "" }, 78)).toEqual({ suppliedFree: 78, owed: 0 });
  expect(parseEmptiesShortageResolution({ suppliedFree: "", owed: "78" }, 78)).toEqual({ suppliedFree: 0, owed: 78 });
  expect(parseEmptiesShortageResolution({ suppliedFree: "76", owed: "2" }, 78)).toEqual({ suppliedFree: 76, owed: 2 });
  expect(parseEmptiesShortageResolution({ suppliedFree: "77", owed: "" }, 78)).toBeNull();
  expect(parseEmptiesShortageResolution({ suppliedFree: "78", owed: "-1" }, 78)).toBeNull();
  expect(parseEmptiesShortageResolution({ suppliedFree: "78", owed: "1.5" }, 78)).toBeNull();
});

it("suggests the rounded-up crate count for a partial pack", async () => {
  vi.mocked(purchasesApi.previewEmpties).mockResolvedValue({
    lines: [{
      index: 0,
      requirements: [{
        typeId: "crate-type",
        kind: "CRATE",
        quantity: 2,
        manualCrateCount: true,
        suggestedCrateCount: 2,
      }],
    }],
    totals: [{
      typeId: "crate-type",
      kind: "CRATE",
      label: "IB crates",
      required: 2,
      available: 2,
      shortage: 0,
    }],
  });
  const onCrateCountChange = vi.fn();
  renderCheck(onCrateCountChange);

  await waitFor(() => expect(onCrateCountChange).toHaveBeenCalledWith("line-1", "2", true));
  expect(screen.getByLabelText("Whole crates delivered")).toHaveProperty("value", "2");
});

it("prefills the optional single-unit crate count with zero", async () => {
  vi.mocked(purchasesApi.previewEmpties).mockResolvedValue({
    lines: [{
      index: 0,
      requirements: [{
        typeId: "crate-type",
        kind: "CRATE",
        quantity: 0,
        manualCrateCount: true,
        suggestedCrateCount: null,
      }],
    }],
    totals: [{
      typeId: "crate-type",
      kind: "CRATE",
      label: "IB crates",
      required: 0,
      available: 2,
      shortage: 0,
    }],
  });
  const onCrateCountChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PurchaseEmptiesCheck
        lines={[{ id: "line-1", productId: product.id, unit: "UNIT", quantity: "1" }]}
        products={new Map([[product.id, product]])}
        supplierId="supplier-1"
        resolutions={{}}
        onCrateCountChange={onCrateCountChange}
        onResolutionChange={vi.fn()}
      />
    </QueryClientProvider>,
  );

  await waitFor(() => expect(onCrateCountChange).toHaveBeenCalledWith("line-1", "0", true));
  expect(screen.getByLabelText("Whole crates delivered (optional)")).toHaveProperty("value", "0");
});

it("shows nothing for sufficient empties", async () => {
  vi.mocked(purchasesApi.previewEmpties).mockResolvedValue({
    lines: [{ index: 0, requirements: [] }],
    totals: [{
      typeId: "crate-type",
      kind: "CRATE",
      label: "IB crates",
      required: 2,
      available: 10,
      shortage: 0,
    }],
  });
  const { container } = renderCheck();
  await waitFor(() => expect(purchasesApi.previewEmpties).toHaveBeenCalled());
  expect(container.textContent).toBe("");
});
