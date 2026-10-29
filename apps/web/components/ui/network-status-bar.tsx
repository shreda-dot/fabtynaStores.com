"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CloudOff, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { reevaluateConnectivity } from "@/stores/network-store";
import { cn } from "@/lib/cn";

const BAR_HEIGHT_VAR = "--network-bar-height";

/**
 * Single bar pinned above the app chrome. Reserves its own height via a CSS
 * variable so nothing is pushed off-screen and there is no layout jump.
 */
export function NetworkStatusBar() {
  const { status } = useNetworkStatus();
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);
  const visible = status !== "online";

  useEffect(() => {
    const root = document.documentElement;
    if (visible) {
      root.style.setProperty(BAR_HEIGHT_VAR, "2.75rem");
    } else {
      root.style.removeProperty(BAR_HEIGHT_VAR);
    }
    return () => {
      root.style.removeProperty(BAR_HEIGHT_VAR);
    };
  }, [visible]);

  async function retry() {
    if (retrying) return;
    setRetrying(true);
    try {
      // Ask the browser first: it can know a link is back before the app does.
      // The refetch that follows settles the real state via the network store.
      reevaluateConnectivity();
      await queryClient.invalidateQueries();
    } finally {
      setRetrying(false);
    }
  }

  if (!visible) return null;

  const config =
    status === "offline"
      ? {
          Icon: WifiOff,
          text: "You're offline. Changes can't be saved until you reconnect.",
          tone: "bg-danger text-danger-foreground",
          transport: "major",
        }
      : status === "slow"
        ? {
            Icon: CloudOff,
            text: "Slow connection. Things may take longer than usual.",
            tone: "bg-warning text-warning-foreground",
            transport: "polite",
          }
        : {
            Icon: Wifi,
            text: "Back online.",
            tone: "bg-success text-success-foreground",
            transport: "polite",
          };

  const { Icon, text, tone, transport } = config;

  return (
    <div
      role="status"
      aria-live={transport === "major" ? "assertive" : "polite"}
      className={cn(
        "fixed inset-x-0 top-0 z-[70] flex min-h-11 items-center justify-center gap-3 px-3 py-2 text-center text-sm font-medium",
        tone,
      )}
      style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
    >
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
      <span>{text}</span>
      {status !== "back-online" && (
        <button
          type="button"
          onClick={() => void retry()}
          disabled={retrying}
          className="inline-flex min-h-9 items-center gap-1 rounded-md border border-current/40 px-2.5 text-xs font-semibold hover:bg-black/10 disabled:opacity-60 dark:hover:bg-white/10"
        >
          <RefreshCw
            aria-hidden="true"
            className={cn("h-3.5 w-3.5", retrying && "animate-spin")}
          />
          {retrying ? "Retrying…" : "Retry"}
        </button>
      )}
    </div>
  );
}
