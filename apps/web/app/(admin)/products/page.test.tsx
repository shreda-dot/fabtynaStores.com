// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { productsApi } from "@/lib/api";
import { ApiError } from "@/lib/api/client";
import { toast } from "@/stores/toast-store";
import ProductsPage from "./page";

vi.mock("@/lib/api", () => ({
  productsApi: { listPage: vi.fn(), create: vi.fn() },
}));
vi.mock("@/hooks/use-network-status", () => ({
  useNetworkStatus: () => ({ offline: false }),
}));
vi.mock("@/stores/toast-store", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("submits a blank SKU and displays a rejected save without an unhandled error", async () => {
  vi.mocked(productsApi.listPage).mockResolvedValue({ items: [], nextCursor: null });
  vi.mocked(productsApi.create)
    .mockRejectedValueOnce(new ApiError("validation", "The product is not valid.", {
      details: { issues: [{ path: ["name"], message: "Choose a different name." }] },
    }))
    .mockImplementationOnce(async (input) => ({
      ...input,
      id: "product-1",
      averageCostKobo: "0",
      deletedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ProductsPage />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getAllByRole("button", { name: "Add product" })[0]);
  fireEvent.change(screen.getByLabelText("Product name"), { target: { value: "Test drink" } });
  fireEvent.change(screen.getByLabelText("Purchase containers"), { target: { value: "NON_RETURNABLE" } });
  fireEvent.change(screen.getByLabelText("Retail price per unit"), { target: { value: "100" } });
  fireEvent.change(screen.getByLabelText("Wholesale price per crate"), { target: { value: "1000" } });
  const dialog = screen.getByRole("dialog");
  fireEvent.submit(dialog.querySelector("form")!);

  await waitFor(() => expect(productsApi.create).toHaveBeenCalledWith(
    expect.objectContaining({ sku: null, emptiesClassification: "NON_RETURNABLE" }),
    expect.any(String),
  ));
  expect(await screen.findByText("Choose a different name.")).toBeTruthy();
  expect(toast.error).toHaveBeenCalledWith("The product is not valid.");
  fireEvent.change(screen.getByLabelText("Product name"), { target: { value: "Another drink" } });
  fireEvent.submit(dialog.querySelector("form")!);
  await waitFor(() => expect(productsApi.create).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}, 20_000);
