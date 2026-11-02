import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast, toastDuration, useToastStore } from "./toast-store";

const success = toast["success"];

describe("toast store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-26T12:00:00.000Z"));
    useToastStore.getState().clear();
  });

  afterEach(() => {
    useToastStore.getState().clear();
    vi.useRealTimers();
  });

  it("merges identical messages emitted within two seconds", () => {
    // Hand calculation: both calls are 1,000 ms apart, inside the 2,000 ms dedupe window.
    success("Saved test record.");
    vi.advanceTimersByTime(1_000);
    success("Saved test record.");

    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it("keeps no more than three visible toasts", () => {
    // Hand calculation: four distinct messages are pushed; the store keeps the newest three.
    success("First test record.");
    success("Second test record.");
    success("Third test record.");
    success("Fourth test record.");

    expect(useToastStore.getState().toasts).toHaveLength(3);
    expect(useToastStore.getState().toasts[0]?.message).toBe("Fourth test record.");
  });

  it("auto-dismisses success after four seconds and leaves errors dismissible indefinitely", () => {
    expect(toastDuration("success")).toBe(4_000);
    expect(toastDuration("error")).toBe(0);
  });
});
