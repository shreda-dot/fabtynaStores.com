"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import { createWriteFlow, type WriteFlowStatus } from "@/lib/write-flow";

export const SAVING_AFTER_MS = 8_000;
export const STILL_WORKING_AFTER_MS = 30_000;

export type WritePhase = "none" | "saving" | "still-working";

/** How a write finally ended after the client had stopped waiting for it. */
export type LateWriteResult<T> = { ok: true; value: T } | { ok: false; cause: unknown };

export type UseWriteFlow = {
  status: WriteFlowStatus;
  error: unknown;
  /** Wording stage while pending: "Saving...", then "Still working". */
  phase: WritePhase;
  pending: boolean;
  /** True when a success was learned after the client had given up waiting. */
  reconciled: boolean;
  /**
   * Runs one write with the intent's idempotency key. Resolves to the value on
   * success; undefined when it failed, ended UNKNOWN, or a write was already
   * pending. Never retries by itself.
   *
   * `onLate` is called if the request that the client had given up waiting for
   * settles later (the API transaction keeps running; it is never aborted).
   */
  run<T>(
    action: (idempotencyKey: string) => Promise<T>,
    options?: { onLate?: (result: LateWriteResult<T>) => void },
  ): Promise<T | undefined>;
  /** Call when the user edits the form: renews the key. */
  edit(): void;
  /** Back to idle after the result was shown. */
  reset(): void;
  /** Back to idle after the user checked the result themselves; keeps the key. */
  dismiss(): void;
};

export function useWriteFlow(): UseWriteFlow {
  const [flow] = useState(() => createWriteFlow());
  const queryClient = useQueryClient();

  const state = useSyncExternalStore(flow.subscribe, flow.getState, flow.getState);
  const [elapsedPhase, setPhase] = useState<WritePhase>("none");
  const phase: WritePhase = state.status === "pending" ? elapsedPhase : "none";

  useEffect(() => {
    if (state.status !== "pending") return;
    const saving = setTimeout(() => setPhase("saving"), SAVING_AFTER_MS);
    const still = setTimeout(() => setPhase("still-working"), STILL_WORKING_AFTER_MS);
    return () => {
      clearTimeout(saving);
      clearTimeout(still);
      setPhase("none");
    };
  }, [state.status]);

  useEffect(() => {
    if (state.status !== "pending") return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state.status]);

  const run = useCallback(
    async <T,>(
      action: (idempotencyKey: string) => Promise<T>,
      options?: { onLate?: (result: LateWriteResult<T>) => void },
    ) => {
      const key = flow.begin();
      if (key === null) return undefined;
      try {
        const value = await action(key);
        flow.succeed();
        return value;
      } catch (cause) {
        const status = flow.fail(cause);
        if (status === "unknown" && cause instanceof ApiError && cause.lateOutcome !== undefined) {
          // The client stopped waiting, but the request was left running because
          // it may already have been recorded. When the API finally answers,
          // replace "we are not sure" with the true result.
          void cause.lateOutcome.then((outcome) => {
            if (outcome.ok) {
              if (flow.lateSucceed(key)) void queryClient.invalidateQueries();
              options?.onLate?.({ ok: true, value: outcome.value as T });
            } else {
              flow.lateFail(key, outcome.cause);
              options?.onLate?.({ ok: false, cause: outcome.cause });
            }
          });
        }
        return undefined;
      }
    },
    [flow, queryClient],
  );

  // Stable identities: pages use `edit` as an effect dependency, and a changing
  // identity would wipe an UNKNOWN state (and renew its key) on every status change.
  const edit = useCallback(() => flow.edit(), [flow]);
  const reset = useCallback(() => flow.reset(), [flow]);
  const dismiss = useCallback(() => flow.dismiss(), [flow]);

  return useMemo(
    () => ({
      status: state.status,
      error: state.error,
      phase,
      pending: state.status === "pending",
      reconciled: state.reconciled,
      run,
      edit,
      reset,
      dismiss,
    }),
    [state.status, state.error, state.reconciled, phase, run, edit, reset, dismiss],
  );
}
