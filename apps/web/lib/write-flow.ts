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
 * - failed:  the API answered with a definite rejection (a business or
 *            validation error, 4xx), so nothing was written. The key is kept
 *            until the user edits the form (`edit()`), then renewed.
 * - unknown: the client never learned a definite answer — the timeout fired, the
 *            connection failed after the request was sent, or a 5xx/unreadable
 *            answer arrived (a gateway can fail after the API committed). The
 *            write may have happened, so the SAME key is kept and `begin()`
 *            (Retry safely) reuses it. When the original request finally settles,
 *            `lateSucceed()`/`lateFail()` replace this guess with the truth.
 * - success: a confirmed success releases the key, so the next intent gets a new
 *            one. A success learned late (reconciled) keeps the key: re-submitting
 *            the same unchanged form replays instead of duplicating.
 * Nothing here retries automatically.
 */
export type WriteFlowStatus = "idle" | "pending" | "success" | "failed" | "unknown";

export type WriteFlowState = {
  status: WriteFlowStatus;
  /** Last error, kept for display only. */
  error: unknown;
  /** The submission key this state belongs to; null when idle or released. */
  key: string | null;
  /** True when a success was learned after the client had given up waiting. */
  reconciled: boolean;
};

/**
 * Only these prove nothing about the write: the client never learned a definite
 * answer. A 5xx is included because a gateway (502/504) can be produced after
 * the API already committed, and a 500 can be raised after the transaction.
 * `non-json` is added per-status below, because a proxy's HTML/empty 5xx answer
 * is equally unprovable while an unreadable 4xx answer is still a server answer.
 */
const UNKNOWN_KINDS = new Set(["unknown-outcome", "network", "timeout", "server"]);

/** A write is UNKNOWN (not failed) unless the API gave a definite answer. */
export function classifyWriteError(cause: unknown): "failed" | "unknown" {
  if (cause instanceof ApiError) {
    if (UNKNOWN_KINDS.has(cause.kind)) return "unknown";
    if (cause.kind === "non-json" && (cause.status === undefined || cause.status >= 500)) {
      return "unknown";
    }
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
  /**
   * The truth arrived after the client had stopped waiting. Ignored unless the
   * flow is still `unknown` for that exact submission key (the user may have
   * edited the form or retried since).
   */
  lateSucceed(key: string): boolean;
  lateFail(key: string, cause: unknown): "failed" | "unknown" | null;
  /** The user changed the form: forget the old outcome and renew the key. */
  edit(): void;
  /** Back to idle after the result was shown; the key is already released. */
  reset(): void;
  /** Back to idle after the user checked the result themselves; keeps the key. */
  dismiss(): void;
};

export function createWriteFlow(makeKey?: () => string): WriteFlow {
  const intent: IdempotencyIntent = createIdempotencyIntent(makeKey);
  let state: WriteFlowState = { status: "idle", error: null, key: null, reconciled: false };
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
      set({ status: "pending", error: null, key, reconciled: false });
      return key;
    },
    succeed() {
      intent.markSucceeded();
      set({ status: "success", error: null, key: null, reconciled: false });
    },
    fail(cause) {
      const status = classifyWriteError(cause);
      set({ status, error: cause, key: state.key, reconciled: false });
      return status;
    },
    lateSucceed(key) {
      if (state.status !== "unknown" || state.key !== key) return false;
      // Deliberately does NOT release the key: an accidental re-submit of the
      // unchanged form must replay the original result, not create a second one.
      set({ status: "success", error: null, key, reconciled: true });
      return true;
    },
    lateFail(key, cause) {
      if (state.status !== "unknown" || state.key !== key) return null;
      const status = classifyWriteError(cause);
      set({ status, error: cause, key, reconciled: false });
      return status;
    },
    edit() {
      if (state.status === "pending") return;
      intent.reset();
      if (state.status !== "idle" || state.key !== null) {
        set({ status: "idle", error: null, key: null, reconciled: false });
      }
    },
    reset() {
      if (state.status === "pending") return;
      intent.reset();
      set({ status: "idle", error: null, key: null, reconciled: false });
    },
    dismiss() {
      if (state.status === "pending") return;
      set({ status: "idle", error: null, key: state.key, reconciled: false });
    },
  };
}
