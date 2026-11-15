// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptiesApi } from "@/lib/api";
import type { EmptiesTypeDto, ProductOwnerDto } from "@/lib/api/empties.api";
import EmptiesProductsPage from "./page";

vi.mock("@/lib/api", () => ({
  isMockApiMode: false,
  emptiesApi: {
    listOwners: vi.fn(),
    listTypes: vi.fn(),
    listProductOwners: vi.fn(),
    assignProductPackaging: vi.fn(),
  },
}));

const product: ProductOwnerDto = {
  productId: "product",
  productName: "Drink",
  sku: null,
  unitsPerPack: 12,
  ownerId: "brewery",
  ownerName: "Brewery",
  ownerIsActive: true,
  packaging: [],
};

function bottle(id: string, ownerId = "brewery", isActive = true): EmptiesTypeDto {
  return {
    id, ownerId, ownerName: "Brewery", kind: "BOTTLE", label: id,
    isActive, unitValueKobo: null, createdAt: "2026-01-01T00:00:00Z",
  };
}

function renderPage(types: EmptiesTypeDto[], row = product) {
  vi.mocked(emptiesApi.listOwners).mockResolvedValue([]);
  vi.mocked(emptiesApi.listTypes).mockResolvedValue(types);
  vi.mocked(emptiesApi.listProductOwners).mockResolvedValue({ items: [row], nextCursor: null });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EmptiesProductsPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("retail bottle settings", () => {
  it("explains how to create a bottle type when none belongs to the brewery", async () => {
    renderPage([bottle("Other brewery bottle", "other")]);
    const select = await screen.findByLabelText("Bottle type");
    expect(within(select).getAllByRole("option")).toHaveLength(1);
    expect(screen.getByText(/No active bottle type is available for Brewery/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add or reactivate a bottle type" }).getAttribute("href")).toBe("/empties/types");
  });

  it("offers reactivation when the brewery's bottle type is inactive", async () => {
    renderPage([bottle("Inactive bottle", "brewery", false)]);
    const select = await screen.findByLabelText("Bottle type");
    expect((within(select).getByRole("option", { name: "Inactive bottle (inactive)" }) as HTMLOptionElement).disabled).toBe(true);
    expect(screen.getByText(/No active bottle type is available/)).toBeTruthy();
  });

  it("explains untracked sales and saves an active bottle with one per retail unit", async () => {
    vi.mocked(emptiesApi.assignProductPackaging).mockResolvedValue({ ok: true });
    renderPage([bottle("Active bottle")]);
    const select = await screen.findByLabelText("Bottle type");
    expect(screen.getByText(/Single-unit sales are not tracked/)).toBeTruthy();
    fireEvent.change(select, { target: { value: "Active bottle" } });
    expect(screen.queryByText(/No active bottle type is available/)).toBeNull();
    expect((screen.getByLabelText("Bottles per retail unit") as HTMLInputElement).value).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Save container tracking" }));
    await waitFor(() => expect(emptiesApi.assignProductPackaging).toHaveBeenCalledWith(
      "product",
      { mappings: [{ typeId: "Active bottle", kind: "BOTTLE", retailQuantityPerUnit: 1, wholesaleQuantityPerPack: 12 }] },
      expect.any(String),
    ));
  });

  it("warns when an existing bottle mapping has a zero retail conversion", async () => {
    renderPage([bottle("Active bottle")], {
      ...product,
      packaging: [{ typeId: "Active bottle", kind: "BOTTLE", label: "Active bottle", retailQuantityPerUnit: 0, wholesaleQuantityPerPack: 12 }],
    });
    expect(await screen.findByText(/Single-unit sales will not record empty bottles/)).toBeTruthy();
  });
});
