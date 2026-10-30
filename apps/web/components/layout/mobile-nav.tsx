"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, X } from "lucide-react";
import {
  activeNavGroup,
  groupNavItems,
  isNavItemActive,
  navGroupSlug,
  toggleNavGroup,
  useOpenNavGroups,
} from "./nav-items";
import { useUIStore } from "@/stores/ui-store";

export function MobileNav() {
  const pathname = usePathname();
  const open = useUIStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useUIStore((s) => s.setMobileNavOpen);
  const openGroups = useOpenNavGroups();
  const currentGroup = activeNavGroup(pathname);

  useEffect(() => {
    if (!open) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileNavOpen(false);
      }
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open, setMobileNavOpen]);

  return (
    <>
      <button
        type="button"
        aria-label="Close navigation menu"
        aria-hidden={!open}
        tabIndex={open ? 0 : -1}
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setMobileNavOpen(false)}
      />
      <aside
        aria-label="Mobile navigation"
        aria-modal={open}
        aria-hidden={!open}
        inert={!open}
        role="dialog"
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform lg:hidden ${
          open ? "translate-x-0" : "pointer-events-none -translate-x-full"
        }`}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-sidebar-border px-4">
          <Link
            href="/dashboard"
            onClick={() => setMobileNavOpen(false)}
            className="flex min-h-11 items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-sidebar-border bg-white p-1">
              <Image
                src="/fabtyna-logo.png"
                alt=""
                aria-hidden="true"
                width={32}
                height={32}
                className="h-full w-full rounded-sm object-contain"
              />
            </span>
            <span className="text-lg font-semibold tracking-tight">Fabtyna</span>
          </Link>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            aria-label="Close navigation"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <nav aria-label="Main navigation" className="flex-1 space-y-1 overflow-y-auto p-3">
          {groupNavItems().map((group) => {
            // Same rule as the sidebar: Dashboard has no heading, and the group
            // holding the current page stays expanded. Toggling a heading must
            // not close the drawer, so the chevron is a plain button, not a link.
            const heading = group.name;
            const lockedOpen = heading !== null && heading === currentGroup;
            const expanded = heading === null || lockedOpen || openGroups.includes(heading);
            const listId = `mobile-nav-group-${heading === null ? "dashboard" : navGroupSlug(heading)}`;
            const chevron = (
              <ChevronDown
                aria-hidden="true"
                className={`h-5 w-5 shrink-0 transition-transform ${expanded ? "rotate-0" : "-rotate-90"}`}
              />
            );

            return (
              <div key={listId}>
                {heading !== null &&
                  (lockedOpen ? (
                    <p className="flex min-h-10 items-center justify-between gap-2 px-3 pt-4 pb-1 text-xs font-semibold tracking-wide text-sidebar-foreground/70 uppercase">
                      {heading}
                      {chevron}
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleNavGroup(heading)}
                      aria-expanded={expanded}
                      aria-controls={listId}
                      className="flex min-h-10 w-full items-center justify-between gap-2 rounded-md px-3 pt-4 pb-1 text-xs font-semibold tracking-wide text-sidebar-foreground/50 uppercase hover:text-sidebar-foreground/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {heading}
                      {chevron}
                    </button>
                  ))}
                <div id={listId} hidden={!expanded} className="space-y-1">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = isNavItemActive(item, pathname);
                    const className = `flex min-h-12 items-center gap-3 rounded-md px-3 text-base font-medium ${
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : item.enabled
                          ? "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                          : "cursor-not-allowed text-sidebar-foreground/50"
                    }`;

                    return item.enabled ? (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileNavOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={className}
                      >
                        <Icon aria-hidden="true" className="h-5 w-5 shrink-0" />
                        {item.label}
                      </Link>
                    ) : (
                      <span key={item.href} aria-disabled="true" className={className} title="Not available yet">
                        <Icon aria-hidden="true" className="h-5 w-5 shrink-0" />
                        {item.label}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
