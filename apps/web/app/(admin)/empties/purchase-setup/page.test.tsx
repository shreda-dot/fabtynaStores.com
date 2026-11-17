// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { emptiesApi } from "@/lib/api";
import PurchaseEmptiesSetupPage from "./page";

vi.mock("@/lib/api", () => ({
  isMockApiMode: false,
  emptiesApi: {
    listTypes: vi.fn(),
    listPurchaseSetup: vi.fn(),
    setPurchaseSetup: vi.fn(),
  },
}));
vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children: ReactNode }) => <>{children}</>,
  CardBody: ({ children }: { children: ReactNode }) => <>{children}</>,
  CardHeader: () => null,
}));

afterEach(cleanup);

it("requires a classification and confirms sale-packaging suggestions before saving", async () => {
  vi.mocked(emptiesApi.listTypes).mockResolvedValue([{
    id: "crate-type",
    ownerId: "owner-1",
    ownerName: "Brewery",
    kind: "CRATE",
    label: "IB crates",
    capacity: null,
    unitValueKobo: null,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  }]);
  vi.mocked(emptiesApi.listPurchaseSetup).mockResolvedValue({
    items: [{
      productId: "product-1",
      productName: "Lager",
      sku: null,
      unitsPerPack: 24,
      isActive: true,
      ownerId: "owner-1",
      ownerName: "Brewery",
      ownerIsActive: true,
      classification: null,
      mappings: [],
      salePackagingSuggestions: [{
        typeId: "crate-type",
        kind: "CRATE",
        label: "IB crates",
        retailQuantityPerUnit: 0,
        wholesaleQuantityPerPack: 1,
      }],
    }],
    nextCursor: null,
  });
  vi.mocked(emptiesApi.setPurchaseSetup).mockResolvedValue({});

  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PurchaseEmptiesSetupPage />
    </QueryClientProvider>,
  );

  expect(await screen.findByText("Not set")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Purchase classification"), { target: { value: "RETURNABLE" } });
  expect(screen.getByLabelText("Crates per full pack")).toHaveProperty("value", "1");
  fireEvent.click(screen.getByRole("button", { name: "Confirm setup" }));

  await waitFor(() => expect(emptiesApi.setPurchaseSetup).toHaveBeenCalledWith(
    "product-1",
    { classification: "RETURNABLE", mappings: [{ kind: "CRATE", typeId: "crate-type", countPerPack: 1 }] },
    expect.any(String),
  ));
});
