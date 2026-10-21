"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { KeyRound, LogOut, Menu, Moon, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useUIStore } from "@/stores/ui-store";
import { navItems } from "./nav-items";
import { DemoDataReset } from "./demo-data-reset";
import { authApi, isMockApiMode } from "@/lib/api";
import { toast } from "@/stores/toast-store";

export function TopBar() {
  const { resolvedTheme, setTheme } = useTheme();
  const toggleMobileNav = useUIStore((s) => s.toggleMobileNav);
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const isDark = resolvedTheme === "dark";
  const pageTitle =
    navItems.find((item) => item.href === pathname)?.label ?? "Fabtyna Stores";

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await authApi.logout();
      router.replace("/login");
    } catch {
      toast.error("Could not sign out. Check your connection and try again.");
      setLoggingOut(false);
    }
  }

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
        {isMockApiMode && <DemoDataReset />}
        <Link
          href="/change-password"
          className="inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <KeyRound aria-hidden="true" className="h-4 w-4" />
          <span className="hidden sm:inline">Change password</span>
        </Link>
        <button
          type="button"
          onClick={() => void logout()}
          disabled={loggingOut}
          className="inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
        >
          <LogOut aria-hidden="true" className="h-4 w-4" />
          <span className="hidden sm:inline">{loggingOut ? "Signing out…" : "Sign out"}</span>
        </button>
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
