"use client";

import { useTheme } from "next-themes";
import { Menu, Moon, Sun } from "lucide-react";
import { usePathname } from "next/navigation";
import { useUIStore } from "@/stores/ui-store";
import { navItems } from "./nav-items";
import { DemoDataReset } from "./demo-data-reset";

export function TopBar() {
  const { resolvedTheme, setTheme } = useTheme();
  const toggleMobileNav = useUIStore((s) => s.toggleMobileNav);
  const pathname = usePathname();
  const isDark = resolvedTheme === "dark";
  const pageTitle =
    navItems.find((item) => item.href === pathname)?.label ?? "Fabtyna Stores";

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-3 text-card-foreground sm:px-5 lg:px-6">
      <button
        type="button"
        onClick={toggleMobileNav}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:hidden"
        aria-label="Open navigation menu"
      >
        <Menu aria-hidden="true" className="h-5 w-5" />
      </button>

      <h1 className="min-w-0 flex-1 truncate text-base font-semibold sm:text-lg">
        {pageTitle}
      </h1>

      <div className="flex shrink-0 items-center gap-2">
        <DemoDataReset />
        <button
          type="button"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
          title={isDark ? "Switch to light theme" : "Switch to dark theme"}
        >
          {isDark ? (
            <Sun aria-hidden="true" className="h-5 w-5" />
          ) : (
            <Moon aria-hidden="true" className="h-5 w-5" />
          )}
        </button>

        <div
          aria-label="Admin account"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground"
        >
          A
        </div>
      </div>
    </header>
  );
}
