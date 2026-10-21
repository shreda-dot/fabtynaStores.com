import { ApiError } from "@/lib/api/client";
import {
  createIdempotencyIntent,
  type IdempotencyIntent,
} from "@/lib/api/idempotency-intent";

/**
 * Pure state machine behind every write (create, payment, reverse, void, amend).
 *
 *   idle -> pending -> success | failed | unknown
 *
 * - failed:  the server answered with a business/validation error. The key is
 *            kept until the user edits the form (`edit()`), then renewed.
 * - unknown: timeout, network failure or any 5xx. The write may have happened,
 *            so the SAME key is kept and `begin()` (Retry safely) reuses it.
 * - success: the key is released, so the next intent gets a new key.
 * Nothing here retries automatically.
 */
export type WriteFlowStatus = "idle" | "pending" | "success" | "failed" | "unknown";

export type WriteFlowState = {
  status: WriteFlowStatus;
  /** Last error, kept for display only. */
  error: unknown;
};

const UNKNOWN_KINDS = new Set([
  "unknown-outcome",
  "network",
  "timeout",
  "server",
  "non-json",
]);

/** A write is UNKNOWN (not failed) unless the API gave a definite 4xx answer. */
export function classifyWriteError(cause: unknown): "failed" | "unknown" {
  if (cause instanceof ApiError) {
    if (UNKNOWN_KINDS.has(cause.kind)) return "unknown";
    if (cause.status !== undefined && cause.status >= 500) return "unknown";
    return "failed";
  }
  // Anything that is not a typed API answer (a thrown bug, a failed fetch
  // that escaped the client) cannot prove the write did not happen.
  return "unknown";
}

export type WriteFlow = {
  getState(): WriteFlowState;
  subscribe(listener: () => void): () => void;
  /** Returns the key to send, or null when a write is already pending. */
  begin(): string | null;
  succeed(): void;
  fail(cause: unknown): "failed" | "unknown";
  /** The user changed the form: forget the old outcome and renew the key. */
  edit(): void;
  /** Back to idle after the result was shown; the key is already released. */
  reset(): void;
};

export function createWriteFlow(makeKey?: () => string): WriteFlow {
  const intent: IdempotencyIntent = createIdempotencyIntent(makeKey);
  let state: WriteFlowState = { status: "idle", error: null };
  const listeners = new Set<() => void>();

  function set(next: WriteFlowState): void {
    state = next;
    for (const listener of listeners) listener();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    begin() {
      if (state.status === "pending") return null;
      const key = intent.getKey();
      set({ status: "pending", error: null });
      return key;
    },
    succeed() {
      intent.markSucceeded();
      set({ status: "success", error: null });
    },
    fail(cause) {
      const status = classifyWriteError(cause);
      set({ status, error: cause });
      return status;
    },
    edit() {
      if (state.status === "pending") return;
      intent.reset();
      if (state.status !== "idle") set({ status: "idle", error: null });
    },
    reset() {
      if (state.status === "pending") return;
      set({ status: "idle", error: null });
    },
  };
}
