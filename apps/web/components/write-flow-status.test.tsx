// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WriteFlowStatus } from "@/components/write-flow-status";
import type { UseWriteFlow } from "@/hooks/use-write-flow";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// The app router is mounted by real pages; here the link is a plain anchor.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

afterEach(cleanup);

function flow(overrides: Partial<UseWriteFlow> = {}): UseWriteFlow {
  return {
    status: "idle",
    error: null,
    phase: "none",
    pending: false,
    reconciled: false,
    run: (async () => undefined) as UseWriteFlow["run"],
    edit: vi.fn(),
    reset: vi.fn(),
    dismiss: vi.fn(),
    ...overrides,
  };
}

function show(status: UseWriteFlow): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <WriteFlowStatus
        flow={status}
        onRetry={vi.fn()}
        checkHref="/sales"
        checkLabel="Check recent sales"
      />
    </QueryClientProvider>,
  );
}

describe("WriteFlowStatus", () => {
  it("shows a non-dismissable pending state", () => {
    show(flow({ status: "pending", pending: true, phase: "still-working" }));

    const panel = screen.getByRole("status");
    expect(panel.textContent).toContain("Still working, please keep this page open.");
    // Nothing in the pending panel can be tapped to make the loading state go away.
    expect(panel.querySelector("button")).toBeNull();
  });

  it("offers Check now and Retry safely after an unknown outcome", async () => {
    const status = flow({ status: "unknown" });
    show(status);

    expect(screen.getByRole("alert").textContent).toContain(
      "We could not confirm whether this was saved.",
    );
    expect(screen.getByRole("button", { name: "Retry safely" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Check now" }));

    // The user has seen the truth, so the warning goes away; the key is kept.
    await waitFor(() => expect(status.dismiss).toHaveBeenCalled());
  });

  it("reports a success that arrived after the client stopped waiting", () => {
    show(flow({ status: "success", reconciled: true }));

    expect(screen.getByRole("status").textContent).toContain("Saved.");
  });
});
