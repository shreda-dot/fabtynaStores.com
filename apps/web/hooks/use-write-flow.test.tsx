// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { useWriteFlow } from "./use-write-flow";
import { useToastStore } from "@/stores/toast-store";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
  useToastStore.getState().clear();
});

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  );
}

describe("useWriteFlow success feedback", () => {
  it("shows exactly one centralized success toast after a successful write", async () => {
    const { result } = renderHook(() => useWriteFlow(), { wrapper });

    await act(async () => {
      await result.current.run<{ reference: string }>(
        "sale.create",
        async () => ({ reference: "S-20261026-000019" }),
        (sale) => ({ reference: sale.reference }),
      );
    });

    // Hand calculation: one successful run creates one toast containing its supplied reference.
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]?.message).toBe("Sale S-20261026-000019 recorded.");
  });

  it("shows no success toast when the write fails", async () => {
    const { result } = renderHook(() => useWriteFlow(), { wrapper });

    await act(async () => {
      await result.current.run("sale.create", async () => {
        throw new Error("write failed");
      });
    });

    // Hand calculation: the rejected write has no successful result, so the success-toast count is zero.
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(0));
  });

  it("shows one toast when an unknown write later confirms success", async () => {
    let resolveLate!: (outcome: { ok: true; value: { reference: string } }) => void;
    const lateOutcome = new Promise<{ ok: true; value: { reference: string } }>((resolve) => {
      resolveLate = resolve;
    });
    const { result } = renderHook(() => useWriteFlow(), { wrapper });

    await act(async () => {
      await result.current.run<{ reference: string }>(
        "sale.create",
        async () => {
          throw new ApiError("unknown-outcome", "Unknown outcome.", { lateOutcome });
        },
        (sale) => ({ reference: sale.reference }),
      );
    });
    // Hand calculation: before the late response, no completed write is confirmed.
    expect(useToastStore.getState().toasts).toHaveLength(0);

    await act(async () => {
      resolveLate({ ok: true, value: { reference: "S-20261026-000020" } });
    });
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    // Hand calculation: the late result supplies one reference and the hook emits one toast.
    expect(useToastStore.getState().toasts[0]?.message).toBe("Sale S-20261026-000020 recorded.");
  });
});
