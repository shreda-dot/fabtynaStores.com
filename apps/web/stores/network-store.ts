"use client";

import { create } from "zustand";

export type NetworkStatus = "online" | "offline" | "slow" | "back-online";

/** A request slower than this counts as "slow". */
const SLOW_THRESHOLD_MS = 4000;
const SAMPLE_WINDOW = 3;
/** Consecutive healthy requests before "slow" clears. */
const HEALTHY_STREAK = 3;

type NetworkState = {
  status: NetworkStatus;
  recentDurations: number[];
  healthyStreak: number;
  setStatus: (status: NetworkStatus) => void;
  /** Records a completed request and derives the slow/healthy state. */
  recordSuccess: (durationMs: number) => void;
  /** Records a network/timeout failure. */
  recordFailure: () => void;
};

export const useNetworkStore = create<NetworkState>((set) => ({
  status: "online",
  recentDurations: [],
  healthyStreak: 0,
  setStatus: (status) => set({ status }),
  recordSuccess: (durationMs) =>
    set((state) => {
      const recentDurations = [...state.recentDurations, durationMs].slice(
        -SAMPLE_WINDOW,
      );
      const slowCount = recentDurations.filter(
        (duration) => duration > SLOW_THRESHOLD_MS,
      ).length;
      const healthyStreak =
        durationMs <= SLOW_THRESHOLD_MS ? state.healthyStreak + 1 : 0;

      let status = state.status;
      if (status === "online" || status === "slow") {
        if (slowCount >= 2) {
          status = "slow";
        } else if (status === "slow" && healthyStreak >= HEALTHY_STREAK) {
          status = "online";
        }
      }
      return { recentDurations, healthyStreak, status };
    }),
  recordFailure: () => {
    reevaluateConnectivity();
  },
}));

/**
 * Re-derives connectivity after a failure. Uses `navigator.onLine` and, when the
 * browser believes it is online, falls back to "slow" until a request succeeds
 * (which covers captive portals / flaky connections). A browser that reports a
 * connection also clears a stale "offline" verdict, so a manual retry can recover.
 */
export function reevaluateConnectivity(): void {
  if (typeof navigator === "undefined") return;
  if (navigator.onLine === false) {
    useNetworkStore.setState({ status: "offline", healthyStreak: 0 });
    return;
  }
  if (useNetworkStore.getState().status === "back-online") return;
  useNetworkStore.setState({ status: "slow", healthyStreak: 0 });
}

export function isOffline(): boolean {
  return useNetworkStore.getState().status === "offline";
}
