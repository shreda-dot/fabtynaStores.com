// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QuickAddCustomerDialog } from "@/components/customers/quick-add-customer-dialog";
import { ApiError } from "@/lib/api/client";
import { toast } from "@/stores/toast-store";
import CustomersPage from "./page";
import SuppliersPage from "../suppliers/page";

const apis = vi.hoisted(() => ({
  customers: { listPage: vi.fn(), getById: vi.fn(), create: vi.fn(), update: vi.fn() },
  suppliers: { listPage: vi.fn(), getById: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
vi.mock("@/lib/api", () => ({ customersApi: apis.customers, suppliersApi: apis.suppliers }));
vi.mock("@/hooks/use-network-status", () => ({
  useNetworkStatus: () => ({ offline: false }),
}));
vi.mock("@/stores/toast-store", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function renderWithClient(child: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {child}
    </QueryClientProvider>,
  );
}

const customer = {
  id: "customer-1", name: "Original customer", type: "RETAIL", creditLimitKobo: "0",
  phone: null, email: null, address: null, notes: null, active: true,
};
const supplier = {
  id: "supplier-1", name: "Original supplier",
  phone: null, email: null, address: null, notes: null, active: true,
};

it.each([
  { kind: "customer", edit: false },
  { kind: "customer", edit: true },
  { kind: "supplier", edit: false },
  { kind: "supplier", edit: true },
] as const)("shows and recovers from a failed $kind $edit save", async ({ kind, edit }) => {
  const isCustomer = kind === "customer";
  const api = isCustomer ? apis.customers : apis.suppliers;
  const record = isCustomer ? customer : supplier;
  api.listPage.mockResolvedValue({ items: edit ? [record] : [], nextCursor: null });
  api.getById.mockResolvedValue(isCustomer ? { customer } : { supplier });
  const save = edit ? api.update : api.create;
  save.mockRejectedValueOnce(new ApiError("validation", "Could not save.", {
    details: { issues: [{ path: ["name"], message: "Choose another name." }] },
  })).mockResolvedValueOnce(record);
  renderWithClient(isCustomer ? <CustomersPage /> : <SuppliersPage />);

  if (edit) {
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit" }))[0]);
    await screen.findByRole("dialog");
  } else {
    fireEvent.click(screen.getAllByRole("button", { name: `Add ${kind}` })[0]);
  }
  const dialog = screen.getByRole("dialog");
  fireEvent.change(screen.getByLabelText(isCustomer ? "Customer name" : "Supplier name"), {
    target: { value: "First name" },
  });
  fireEvent.submit(dialog.querySelector("form")!);
  expect(await screen.findByText("Choose another name.")).toBeTruthy();
  expect(toast.error).toHaveBeenCalledWith("Could not save.");
  expect(screen.getByRole("dialog")).toBeTruthy();

  fireEvent.change(screen.getByLabelText(isCustomer ? "Customer name" : "Supplier name"), {
    target: { value: "Corrected name" },
  });
  fireEvent.submit(dialog.querySelector("form")!);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}, 30_000);

it("keeps quick-add open on failure and selects the customer only after a successful retry", async () => {
  const onCreated = vi.fn();
  const onClose = vi.fn();
  apis.customers.create
    .mockRejectedValueOnce(new ApiError("server", "Could not save customer."))
    .mockResolvedValueOnce(customer);
  renderWithClient(
    <QuickAddCustomerDialog open defaultType="RETAIL" onClose={onClose} onCreated={onCreated} />,
  );
  fireEvent.change(screen.getByLabelText("Customer name"), { target: { value: "Quick customer" } });
  const dialog = screen.getByRole("dialog");
  fireEvent.submit(dialog.querySelector("form")!);
  expect(await screen.findByText("Could not save customer.")).toBeTruthy();
  expect(toast.error).toHaveBeenCalledWith("Could not save customer.");
  expect(onCreated).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();

  fireEvent.submit(dialog.querySelector("form")!);
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith(customer));
  expect(onClose).toHaveBeenCalledOnce();
}, 30_000);
