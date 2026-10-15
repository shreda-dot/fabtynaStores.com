"use client";

import { useEffect, useState } from "react";
import { getLagosBusinessDate } from "@fabtyna/shared";

/**
 * Returns the current business date (YYYY-MM-DD) in Africa/Lagos time.
 *
 * The value is re-checked every 30 seconds so that when Lagos crosses
 * midnight the returned date changes, which re-runs any dependent query
 * (keyed on the date) and resets "today" figures back to zero — even while
 * the page stays open. This is independent of the device timezone.
 */
export function useLagosBusinessDate(): string {
  const [businessDate, setBusinessDate] = useState(() => getLagosBusinessDate());

  useEffect(() => {
    const interval = setInterval(() => {
      setBusinessDate(getLagosBusinessDate());
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  return businessDate;
}
