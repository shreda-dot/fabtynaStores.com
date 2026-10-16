"use client";

import { useNetworkStore, type NetworkStatus } from "@/stores/network-store";

export type NetworkStatusInfo = {
  status: NetworkStatus;
  online: boolean;
  offline: boolean;
  slow: boolean;
};

export function useNetworkStatus(): NetworkStatusInfo {
  const status = useNetworkStore((state) => state.status);
  return {
    status,
    online: status === "online" || status === "back-online",
    offline: status === "offline",
    slow: status === "slow",
  };
}
