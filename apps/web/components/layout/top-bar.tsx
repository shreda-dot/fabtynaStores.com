"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { KeyRound, LogOut, Menu, Moon, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useUIStore } from "@/stores/ui-store";
import { navItems } from "./nav-items";
import { DemoDataReset } from "./demo-data-reset";
import { InstallButton } from "@/components/pwa/install-button";
import { authApi, isMockApiMode } from "@/lib/api";
import { clearAllDrafts, setDraftUser } from "@/lib/form-draft";
import { toast } from "@/stores/toast-store";

export function TopBar() {
  const { resolvedTheme, setTheme } = useTheme();
  const toggleMobileNav = useUIStore((s) => s.toggleMobileNav);
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isDark = resolvedTheme === "dark";
  const pageTitle =
    navItems.find((item) => item.href === pathname)?.label ?? "Fabtyna Stores";

  // Close the account menu when the page changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Close the account menu on outside tap or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await authApi.logout();
      clearAllDrafts();
      setDraftUser(null);
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

      <div className="flex shrink-0 items-center gap-3">
        {isMockApiMode && <DemoDataReset />}
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

        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-label="Account menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            A
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-12 z-40 w-56 rounded-md border border-border bg-card p-1 text-card-foreground shadow-lg"
            >
              <Link
                role="menuitem"
                href="/change-password"
                onClick={() => setMenuOpen(false)}
                className="flex h-11 items-center gap-2 rounded-md px-3 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                <KeyRound aria-hidden="true" className="h-4 w-4" />
                Change password
              </Link>
              <div className="px-3 py-2 empty:hidden">
                <InstallButton />
              </div>
              <div role="separator" className="my-1 h-px bg-border" />
              <button
                type="button"
                role="menuitem"
                onClick={() => void logout()}
                disabled={loggingOut}
                className="flex h-11 w-full items-center gap-2 rounded-md px-3 text-sm font-medium text-danger hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
              >
                <LogOut aria-hidden="true" className="h-4 w-4" />
                {loggingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}