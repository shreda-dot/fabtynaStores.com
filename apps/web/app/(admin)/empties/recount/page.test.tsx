// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { emptiesApi } from "@/lib/api";
import EmptiesRecountPage from "./page";

vi.mock("@/lib/api", () => ({
  isMockApiMode: false,
  emptiesApi: {
    getSizeClassRecount: vi.fn(),
    beginSizeClassRecount: vi.fn(),
    submitSizeClassRecount: vi.fn(),
  },
}));

afterEach(cleanup);

it("submits all size-class counts together with the required reason", async () => {
  vi.mocked(emptiesApi.getSizeClassRecount).mockResolvedValue({
    phase: "RECOUNT_PENDING",
    classes: [{
      typeId: "type-12",
      ownerId: "owner-1",
      ownerName: "International Breweries",
      label: "12-bottle",
      capacity: 12,
      quantity: 36,
    }],
  });
  vi.mocked(emptiesApi.submitSizeClassRecount).mockResolvedValue({
    phase: "READY",
    changes: [],
  });

  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EmptiesRecountPage />
    </QueryClientProvider>,
  );

  fireEvent.change(await screen.findByLabelText("Empty crates"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("Loose bottles"), { target: { value: "5" } });
  fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Opening count after launch" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm all counts" }));

  await waitFor(() => expect(emptiesApi.submitSizeClassRecount).toHaveBeenCalledWith(
    {
      counts: [{ typeId: "type-12", emptyCrates: 3, looseBottles: 5 }],
      reason: "Opening count after launch",
    },
    expect.any(String),
  ));
});

it("rejects a loose remainder equal to the class capacity before posting", async () => {
  vi.mocked(emptiesApi.getSizeClassRecount).mockResolvedValue({
    phase: "RECOUNT_PENDING",
    classes: [{
      typeId: "type-12",
      ownerId: "owner-1",
      ownerName: "International Breweries",
      label: "12-bottle",
      capacity: 12,
      quantity: 36,
    }],
  });

  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EmptiesRecountPage />
    </QueryClientProvider>,
  );

  fireEvent.change(await screen.findByLabelText("Empty crates"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("Loose bottles"), { target: { value: "12" } });
  fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Counted again" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm all counts" }));

  expect((await screen.findByRole("alert")).textContent).toContain("must be fewer than 12");
  expect(emptiesApi.submitSizeClassRecount).not.toHaveBeenCalled();
});
