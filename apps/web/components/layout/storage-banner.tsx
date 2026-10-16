"use client";

import { useSyncExternalStore } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import {
  getMockStoreBackupNotice,
  isMockStoreInMemoryOnly,
  resetDemoData,
} from "@/lib/api/mock-store";
import { Button } from "@/components/ui/button";
import { confirm } from "@/stores/confirm-store";
import { toast } from "@/stores/toast-store";

const NOOP_UNSUBSCRIBE = () => {};

/**
 * Recovery surface for browser storage problems. Shows what went wrong and, for
 * corruption, offers explicit actions (reload / reset demo data) instead of
 * silently discarding the user's data.
 */
export function StorageBanner() {
  const inMemory = useSyncExternalStore(
    () => NOOP_UNSUBSCRIBE,
    isMockStoreInMemoryOnly,
  );
  const notice = useSyncExternalStore(
    () => NOOP_UNSUBSCRIBE,
    getMockStoreBackupNotice,
  );

  if (!inMemory && !notice) return null;

  async function handleReset() {
    const ok = await confirm({
      title: "Reset demo data?",
      description:
        "This replaces the data currently in this browser with a fresh demo dataset. It cannot be undone.",
      confirmLabel: "Reset demo data",
      tone: "danger",
    });
    if (!ok) return;
    try {
      resetDemoData();
      toast.success("Demo data reset. Reloading…");
      window.location.reload();
    } catch {
      toast.error("Could not reset the demo data. Try reloading the page.");
    }
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="mb-4 rounded-md border border-warning/40 bg-warning-surface p-4"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          aria-hidden="true"
          className="mt-0.5 h-5 w-5 shrink-0 text-warning"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-semibold text-warning">
            {notice ? "Saved data could not be read" : "Changes aren't being saved"}
          </p>
          <p className="text-sm text-warning">
            {notice ??
              "This browser is blocking local storage, so the app is running in memory only. Nothing you enter will survive a reload."}
          </p>
          {notice && (
            <p className="text-xs text-muted-foreground">
              A backup of the unreadable data was kept in this browser. Reload to
              try reading it again, or reset the demo data to start fresh.
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => window.location.reload()}
            >
              <RotateCw aria-hidden="true" className="h-3.5 w-3.5" />
              Reload page
            </Button>
            {notice && (
              <Button variant="danger" size="sm" onClick={() => void handleReset()}>
                Reset demo data
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
