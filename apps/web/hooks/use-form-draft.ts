"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearDraft,
  draftStorageKey,
  loadDraft,
  saveDraft,
  type LoadedDraft,
} from "@/lib/form-draft";

const SAVE_DELAY_MS = 500;

export type FormDraft<T> = {
  /** A saved draft waiting for the user's decision, or null. */
  pending: LoadedDraft<T> | null;
  /** Applies the pending draft through `onRestore`. */
  restore: () => void;
  /** Deletes the pending draft and starts blank. */
  discard: () => void;
  /** Call after a successful submit or cancel: deletes the draft and stops saving. */
  clear: () => void;
};

/**
 * Keeps a long form's state in sessionStorage so an accidental refresh does not lose it.
 * - Nothing is filled in automatically: the user chooses Restore or Discard.
 * - Drafts expire after 2 hours and are wiped on logout (see lib/form-draft.ts).
 * - `state` must be JSON-serializable. Money stays as kobo strings.
 * - `dirty` should be false for a pristine form so an empty form never overwrites a draft.
 */
export function useFormDraft<T>({
  form,
  state,
  dirty,
  onRestore,
  enabled = true,
}: {
  form: string;
  state: T;
  dirty: boolean;
  onRestore: (data: T) => void;
  enabled?: boolean;
}): FormDraft<T> {
  const [pending, setPending] = useState<LoadedDraft<T> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const stopped = useRef(false);
  const keyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    keyRef.current = draftStorageKey(form);
    stopped.current = false;
    const key = keyRef.current;
    if (key !== null) setPending(loadDraft<T>(key));
    setLoaded(true);
  }, [form, enabled]);

  // Autosave, debounced. Held back while an old draft awaits a decision.
  useEffect(() => {
    if (!enabled || !loaded || pending !== null || !dirty || stopped.current) return;
    const key = keyRef.current;
    if (key === null) return;
    const timer = window.setTimeout(() => {
      if (!stopped.current) saveDraft(key, state);
    }, SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, loaded, pending, dirty, state]);

  // Unsaved changes: ask the browser to confirm a refresh or close.
  useEffect(() => {
    if (!enabled || !dirty || stopped.current) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [enabled, dirty]);

  const restore = useCallback(() => {
    if (pending === null) return;
    const data = pending.data;
    setPending(null);
    onRestore(data);
  }, [pending, onRestore]);

  const discard = useCallback(() => {
    const key = keyRef.current;
    if (key !== null) clearDraft(key);
    setPending(null);
  }, []);

  const clear = useCallback(() => {
    stopped.current = true;
    const key = keyRef.current;
    if (key !== null) clearDraft(key);
    setPending(null);
  }, []);

  return { pending, restore, discard, clear };
}
