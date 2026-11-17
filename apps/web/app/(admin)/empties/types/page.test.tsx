// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { emptiesApi } from "@/lib/api";
import EmptiesTypesPage from "./page";

vi.mock("@/lib/api", () => ({
  isMockApiMode: false,
  emptiesApi: {
    listOwners: vi.fn(),
    listTypes: vi.fn(),
    createType: vi.fn(),
  },
}));

afterEach(cleanup);

it("creates a sized bottle type with the chosen crate capacity", async () => {
  vi.mocked(emptiesApi.listOwners).mockResolvedValue([
    { id: "owner-1", name: "Guinness Nigeria", isActive: true, typeCount: 0, activeTypeCount: 0 },
  ] as never);
  vi.mocked(emptiesApi.listTypes).mockResolvedValue([]);
  vi.mocked(emptiesApi.createType).mockResolvedValue({} as never);

  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EmptiesTypesPage />
    </QueryClientProvider>,
  );

  await screen.findByRole("option", { name: "Guinness Nigeria" });
  fireEvent.change(screen.getByLabelText(/Owner/), { target: { value: "owner-1" } });
  fireEvent.change(screen.getByLabelText(/Kind/), { target: { value: "BOTTLE" } });
  fireEvent.change(screen.getByLabelText(/Bottles per crate/), { target: { value: "24" } });
  fireEvent.change(screen.getByLabelText(/Label/), { target: { value: "Guinness 24" } });
  fireEvent.click(screen.getByRole("button", { name: "Add type" }));

  await waitFor(() => expect(emptiesApi.createType).toHaveBeenCalledWith(
    expect.objectContaining({ ownerId: "owner-1", kind: "BOTTLE", capacity: 24, label: "Guinness 24" }),
    expect.any(String),
  ));
});
