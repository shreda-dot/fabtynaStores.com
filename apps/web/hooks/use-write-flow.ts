"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createWriteFlow, type WriteFlowStatus } from "@/lib/write-flow";

export const SAVING_AFTER_MS = 8_000;
export const STILL_WORKING_AFTER_MS = 30_000;

export type WritePhase = "none" | "saving" | "still-working";

export type UseWriteFlow = {
  status: WriteFlowStatus;
  error: unknown;
  /** Wording stage while pending: nothing, "Saving...", then "Still working". */
  phase: WritePhase;
  pending: boolean;
  /**
   * Runs one write with the intent's idempotency key. Resolves to the value on
   * success; undefined when it failed, ended UNKNOWN, or a write was already
   * pending. Never retries by itself.
   */
  run<T>(action: (idempotencyKey: string) => Promise<T>): Promise<T | undefined>;
  /** Call when the user edits the form: renews the key. */
  edit(): void;
  reset(): void;
};

export function useWriteFlow(): UseWriteFlow {
  const [flow] = useState(() => createWriteFlow());

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
    async <T,>(action: (idempotencyKey: string) => Promise<T>) => {
      const key = flow.begin();
      if (key === null) return undefined;
      try {
        const value = await action(key);
        flow.succeed();
        return value;
      } catch (cause) {
        flow.fail(cause);
        return undefined;
      }
    },
    [flow],
  );

  // Stable identities: pages use `edit` as an effect dependency, and a changing
  // identity would wipe an UNKNOWN state (and renew its key) on every status change.
  const edit = useCallback(() => flow.edit(), [flow]);
  const reset = useCallback(() => flow.reset(), [flow]);

  return useMemo(
    () => ({
      status: state.status,
      error: state.error,
      phase,
      pending: state.status === "pending",
      run,
      edit,
      reset,
    }),
    [state.status, state.error, phase, run, edit, reset],
  );
}
