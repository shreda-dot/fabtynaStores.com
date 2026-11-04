"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

/** Light/dark switch for pages without the app top bar. Icons swap with CSS, so there is no hydration flicker. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  // The theme is unknown on the server, so the label must not depend on it.
  const label = "Switch between light and dark theme";

  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${className}`}
      aria-label={label}
      title={label}
    >
      <Moon aria-hidden="true" className="h-5 w-5 dark:hidden" />
      <Sun aria-hidden="true" className="hidden h-5 w-5 dark:block" />
    </button>
  );
}
