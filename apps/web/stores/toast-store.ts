"use client";

import { create } from "zustand";

export type ToastType = "success" | "error" | "warning" | "info";

export type ToastItem = {
  id: string;
  type: ToastType;
  message: string;
  description?: string;
  /** 0 means "sticky until dismissed" (used by `toast.promise` loading). */
  durationMs: number;
};

type ToastState = {
  toasts: ToastItem[];
  push: (toast: ToastItem) => void;
  update: (id: string, patch: Partial<Omit<ToastItem, "id">>) => void;
  dismiss: (id: string) => void;
  clear: () => void;
};

const MAX_VISIBLE = 3;
const DEDUPE_WINDOW_MS = 2000;
const SUCCESS_DURATION_MS = 4000;
/** Error/warning stay for at least 8s, then the user can still dismiss them. */
const STICKY_DURATION_MS = 8000;

export function toastDuration(type: ToastType): number {
  return type === "success" || type === "info"
    ? SUCCESS_DURATION_MS
    : STICKY_DURATION_MS;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) =>
    set((state) => ({ toasts: [toast, ...state.toasts].slice(0, MAX_VISIBLE) })),
  update: (id, patch) =>
    set((state) => ({
      toasts: state.toasts.map((toast) =>
        toast.id === id ? { ...toast, ...patch } : toast,
      ),
    })),
  dismiss: (id) =>
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

let toastCounter = 0;
function nextToastId(): string {
  toastCounter += 1;
  return `toast-${Date.now().toString(36)}-${toastCounter.toString(36)}`;
}

const recentMessages = new Map<string, number>();
function isDuplicate(type: ToastType, message: string): boolean {
  const key = `${type}:${message}`;
  const now = Date.now();
  const previous = recentMessages.get(key);
  if (previous !== undefined && now - previous < DEDUPE_WINDOW_MS) {
    return true;
  }
  // Opportunistic prune so the map cannot grow unbounded.
  if (recentMessages.size > 50) {
    for (const [entryKey, at] of recentMessages) {
      if (now - at > DEDUPE_WINDOW_MS) recentMessages.delete(entryKey);
    }
  }
  recentMessages.set(key, now);
  return false;
}

function emit(type: ToastType, message: string, description?: string): void {
  if (message.trim() === "") return;
  if (isDuplicate(type, message)) return;
  useToastStore.getState().push({
    id: nextToastId(),
    type,
    message,
    description,
    durationMs: toastDuration(type),
  });
}

export type ToastPromiseMessages<T> = {
  loading: string;
  success: string | ((value: T) => string);
  error: string | ((error: unknown) => string);
};

export const toast = {
  success: (message: string, description?: string) => emit("success", message, description),
  error: (message: string, description?: string) => emit("error", message, description),
  warning: (message: string, description?: string) => emit("warning", message, description),
  info: (message: string, description?: string) => emit("info", message, description),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
  clear: () => useToastStore.getState().clear(),
  async promise<T>(promise: Promise<T>, messages: ToastPromiseMessages<T>): Promise<T> {
    const id = nextToastId();
    useToastStore.getState().push({
      id,
      type: "info",
      message: messages.loading,
      durationMs: 0,
    });
    try {
      const value = await promise;
      const message =
        typeof messages.success === "function"
          ? messages.success(value)
          : messages.success;
      useToastStore.getState().update(id, {
        type: "success",
        message,
        durationMs: toastDuration("success"),
      });
      return value;
    } catch (error) {
      const message =
        typeof messages.error === "function" ? messages.error(error) : messages.error;
      useToastStore.getState().update(id, {
        type: "error",
        message,
        durationMs: toastDuration("error"),
      });
      throw error;
    }
  },
};
