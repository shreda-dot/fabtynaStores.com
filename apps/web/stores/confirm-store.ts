"use client";

import type { ReactNode } from "react";
import { create } from "zustand";

export type ConfirmTone = "normal" | "danger";

export type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  /** Extra content, e.g. a summary list or warning callout. */
  details?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  /**
   * Runs when the user confirms. The dialog shows a loading state while this
   * runs, closes on success and stays open with the error message on failure.
   */
  onConfirm?: () => Promise<unknown> | unknown;
  /** Optional toast fired after `onConfirm` resolves. */
  successMessage?: string;
};

type ConfirmState = {
  current: ConfirmOptions | null;
  resolve: ((result: boolean) => void) | null;
  /** Increments on every `open` so the host can remount with fresh state. */
  token: number;
  open: (options: ConfirmOptions) => Promise<boolean>;
  settle: (result: boolean) => void;
};

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  current: null,
  resolve: null,
  token: 0,
  open: (options) =>
    new Promise<boolean>((resolve) => {
      const pending = get().resolve;
      if (pending) pending(false);
      set({ current: options, resolve, token: get().token + 1 });
    }),
  settle: (result) => {
    const resolve = get().resolve;
    set({ current: null, resolve: null });
    resolve?.(result);
  },
}));

/**
 * Imperative confirmation. Resolves `true` only if the user confirmed and the
 * `onConfirm` action (if any) succeeded.
 *
 *   const ok = await confirm({ title: "Void sale?", tone: "danger" });
 *   if (!ok) return;
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().open(options);
}
