// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accountingApi, productsApi, purchasesApi, suppliersApi } from "@/lib/api";
import type { PurchaseDetailDto, SupplierPaymentDetailDto } from "@/lib/api/purchases.api";
import EditPurchasePage from "./page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "purchase-1" }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  isMockApiMode: true,
  purchasesApi: { getById: vi.fn() },
  productsApi: { list: vi.fn() },
  suppliersApi: { list: vi.fn() },
  accountingApi: { listPaymentAccounts: vi.fn() },
}));

afterEach(cleanup);

const payment: SupplierPaymentDetailDto = {
  id: "payment-1",
  supplierId: "supplier-1",
  purchaseId: "purchase-1",
  accountId: "account-1",
  amountKobo: "100",
  method: "CASH",
  note: null,
  paidAt: "2026-11-10T00:00:00.000Z",
  createdAt: "2026-11-10T00:00:00.000Z",
};

async function showPage(payments: SupplierPaymentDetailDto[]) {
  const purchase: PurchaseDetailDto = {
    id: "purchase-1",
    supplierId: "supplier-1",
    createdById: "user-1",
    status: "RECEIVED",
    reference: null,
    notes: null,
    totalKobo: "100",
    paidKobo: "0",
    dueDate: null,
    purchasedAt: "2026-11-10T00:00:00.000Z",
    receivedAt: "2026-11-10T00:00:00.000Z",
    createdAt: "2026-11-10T00:00:00.000Z",
    updatedAt: "2026-11-10T00:00:00.000Z",
    supplier: { id: "supplier-1", name: "Supplier", phone: null },
    lines: [],
    movements: [],
    payments,
  };
  vi.mocked(purchasesApi.getById).mockResolvedValue(purchase);
  vi.mocked(productsApi.list).mockResolvedValue([]);
  vi.mocked(suppliersApi.list).mockResolvedValue([]);
  vi.mocked(accountingApi.listPaymentAccounts).mockResolvedValue([]);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EditPurchasePage />
    </QueryClientProvider>,
  );
}

describe("purchase edit payment guard", () => {
  it("allows editing when all payments were reversed", async () => {
    await showPage([{ ...payment, reversed: true }]);
    expect(await screen.findByRole("heading", { name: "Edit purchase" })).toBeTruthy();
    expect(screen.getByText("Demo purchases do not check or record supplier empties or empties debts.")).toBeTruthy();
  }, 15_000);

  it.each([false, undefined])("blocks a live or unknown payment (reversed: %s)", async (reversed) => {
    await showPage([{ ...payment, reversed }]);
    expect(await screen.findByText("This purchase has supplier payments")).toBeTruthy();
  }, 15_000);
});
