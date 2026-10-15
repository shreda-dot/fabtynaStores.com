"use client";

import { useSyncExternalStore } from "react";
import {
  getMockStoreBackupNotice,
  isMockStoreInMemoryOnly,
} from "@/lib/api/mock-store";

const NOOP_UNSUBSCRIBE = () => {};

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

  return (
    <div className="space-y-2">
      {inMemory && (
        <div
          role="status"
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
        >
          Changes are not being saved in this browser.
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
        >
          {notice}
        </div>
      )}
    </div>
  );
}
