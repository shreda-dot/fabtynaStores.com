"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNetworkStore } from "@/stores/network-store";

type NetworkInformation = {
  effectiveType?: string;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

type NavigatorWithConnection = Navigator & { connection?: NetworkInformation };

const BACK_ONLINE_VISIBLE_MS = 3000;

/**
 * Feeds the network store from browser connectivity events. Mounted once in the
 * root layout (inside the Query provider so it can refetch on reconnect).
 */
export function NetworkMonitor() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const store = useNetworkStore.getState();

    function goBackOnline() {
      store.setStatus("back-online");
      void queryClient.invalidateQueries();
      window.setTimeout(() => {
        if (useNetworkStore.getState().status === "back-online") {
          store.setStatus("online");
        }
      }, BACK_ONLINE_VISIBLE_MS);
    }

    function applyNavigatorStatus() {
      const nav = navigator as NavigatorWithConnection;
      if (nav.onLine === false) {
        store.setStatus("offline");
        return;
      }
      const effectiveType = nav.connection?.effectiveType;
      if (effectiveType === "slow-2g" || effectiveType === "2g") {
        store.setStatus("slow");
        return;
      }
      if (useNetworkStore.getState().status === "offline") {
        goBackOnline();
      }
    }

    applyNavigatorStatus();

    const handleOnline = () => goBackOnline();
    const handleOffline = () => store.setStatus("offline");
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const connection = (navigator as NavigatorWithConnection).connection;
    const handleConnectionChange = () => applyNavigatorStatus();
    connection?.addEventListener?.("change", handleConnectionChange);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      connection?.removeEventListener?.("change", handleConnectionChange);
    };
  }, [queryClient]);

  return null;
}
