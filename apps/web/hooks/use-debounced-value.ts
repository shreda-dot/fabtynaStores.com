"use client";

import { useEffect, useState } from "react";

/**
 * Returns `value` after it has stopped changing for `delayMs`.
 * Used so list searches do not start a new query on every keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}