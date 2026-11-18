// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptiesApi } from "@/lib/api";
import type { EmptiesOverviewDto } from "@/lib/api/empties.api";
import EmptiesPage from "./page";

vi.mock("@/lib/api", () => ({
  isMockApiMode: false,
  emptiesApi: {
    getOverview: vi.fn(),
    getSizeClassRecount: vi.fn(),
    listBalances: vi.fn(),
    listTypes: vi.fn(),
    listMovements: vi.fn(),
  },
}));
vi.mock("@/components/empties/supplier-empties", () => ({ SupplierEmpties: () => null }));

const overview: EmptiesOverviewDto = {
  owners: [{
    ownerId: "brewery",
    ownerName: "Brewery",
    emptyCrates: 4,
    emptyBottles: 25,
    fullCrates: 18,
    looseUnitsInWarehouse: 0,
    bottlesOnShelfAndMarket: 0,
    totalCrates: 22,
    emptyValueKobo: null,
    sizeClasses: [{
      typeId: "size-20",
      capacity: 20,
      label: "Brewery 20",
      stockBottles: 40,
      emptyBottles: 25,
      emptyCrates: 1,
      looseEmptyBottles: 5,
      totalBottles: 65,
      totalCrates: 3,
      looseTotalBottles: 5,
    }, {
      typeId: "size-12",
      capacity: 12,
      label: "Brewery 12",
      stockBottles: 12,
      emptyBottles: 12,
      emptyCrates: 1,
      looseEmptyBottles: 0,
      totalBottles: 24,
      totalCrates: 2,
      looseTotalBottles: 0,
    }],
    products: [],
  }],
  warnings: {
    productsWithoutBrewery: [],
    assignedCans: [],
    productsAssignedToInactiveOwner: [],
    productsWithoutConfirmedSize: [{
      productId: "unmapped",
      productName: "Unmapped lager",
      unitsPerPack: 20,
      warehouseUnits: 8,
      shelfUnits: 0,
      marketUnits: 0,
      totalUnits: 8,
      ownerName: "Brewery",
    }],
  },
};

beforeEach(() => {
  vi.mocked(emptiesApi.getOverview).mockResolvedValue(overview);
  vi.mocked(emptiesApi.listBalances).mockResolvedValue({ items: [], totalsByOwner: [], totalsByKind: [] });
  vi.mocked(emptiesApi.listTypes).mockResolvedValue([]);
  vi.mocked(emptiesApi.listMovements).mockResolvedValue({ items: [], nextCursor: null, from: null, to: null });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EmptiesPage />
    </QueryClientProvider>,
  );
}

it("shows size totals and warns about unmapped stock instead of showing the legacy total", async () => {
  vi.mocked(emptiesApi.getSizeClassRecount).mockResolvedValue({ phase: "READY", classes: [] });
  renderPage();

  const size = (await screen.findByText("Brewery 20 · 20 bottles per crate")).closest("section");
  expect(size).not.toBeNull();
  expect(within(size!).getByText("3 crates + 5 bottles")).toBeTruthy();
  expect(within(size!).getByText("1 crate + 5 bottles (25 bottles)")).toBeTruthy();
  expect(within(size!).getByText("40")).toBeTruthy();
  const otherSize = screen.getByText("Brewery 12 · 12 bottles per crate").closest("section");
  expect(otherSize).not.toBeNull();
  expect(within(otherSize!).getByText("2 crates + 0 bottles")).toBeTruthy();
  expect(screen.queryByText("Legacy total crates")).toBeNull();
  expect(screen.getByText(/Unmapped lager.*8 units/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Confirm product sizes" }).getAttribute("href")).toBe("/empties/purchase-setup");
});

it("marks size totals incomplete during a recount", async () => {
  vi.mocked(emptiesApi.getSizeClassRecount).mockResolvedValue({ phase: "RECOUNT_PENDING", classes: [] });
  renderPage();
  expect(await screen.findByText("Size totals are incomplete until the recount is confirmed.")).toBeTruthy();
  expect(await screen.findByText("3 crates + 5 bottles")).toBeTruthy();
});

it("keeps the legacy view before cutover and does not fall back to it on a status error", async () => {
  vi.mocked(emptiesApi.getSizeClassRecount).mockResolvedValueOnce({ phase: "LEGACY", classes: [] });
  renderPage();
  expect(await screen.findByText("Legacy total crates")).toBeTruthy();
  expect(screen.queryByText("3 crates + 5 bottles")).toBeNull();
  cleanup();

  vi.mocked(emptiesApi.getSizeClassRecount).mockRejectedValueOnce(new Error("Cannot load status"));
  renderPage();
  expect(await screen.findByText("Empties count status could not be loaded")).toBeTruthy();
  expect(screen.queryByText("Legacy total crates")).toBeNull();
});
