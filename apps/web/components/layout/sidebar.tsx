"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import {
  activeNavGroup,
  groupNavItems,
  isNavItemActive,
  navGroupSlug,
  toggleNavGroup,
  useOpenNavGroups,
} from "./nav-items";

export function Sidebar() {
  const pathname = usePathname();
  const openGroups = useOpenNavGroups();
  const currentGroup = activeNavGroup(pathname);

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
      <Link
        href="/dashboard"
        className="flex h-16 shrink-0 items-center gap-3 border-b border-sidebar-border px-5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
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
        <span className="text-base font-semibold tracking-tight">Fabtyna Stores</span>
      </Link>
      <nav aria-label="Main navigation" className="flex-1 space-y-1 overflow-y-auto p-3">
        {groupNavItems().map((group) => {
          // Dashboard has no heading and is never collapsed. Every other group
          // is collapsed unless the user opened it, except the one holding the
          // current page, which is always expanded so the highlight is visible.
          const heading = group.name;
          const lockedOpen = heading !== null && heading === currentGroup;
          const open = heading === null || lockedOpen || openGroups.includes(heading);
          const listId = `sidebar-nav-group-${heading === null ? "dashboard" : navGroupSlug(heading)}`;
          const chevron = (
            <ChevronDown
              aria-hidden="true"
              className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-0" : "-rotate-90"}`}
            />
          );

          return (
            <div key={listId}>
              {heading !== null &&
                (lockedOpen ? (
                  <p className="flex min-h-9 items-center justify-between gap-2 px-3 pt-4 pb-1 text-xs font-semibold tracking-wide text-sidebar-foreground/70 uppercase">
                    {heading}
                    {chevron}
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleNavGroup(heading)}
                    aria-expanded={open}
                    aria-controls={listId}
                    className="flex min-h-9 w-full items-center justify-between gap-2 rounded-md px-3 pt-4 pb-1 text-xs font-semibold tracking-wide text-sidebar-foreground/50 uppercase hover:text-sidebar-foreground/80 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                  >
                    {heading}
                    {chevron}
                  </button>
                ))}
              <div id={listId} hidden={!open} className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isNavItemActive(item, pathname);
                  const className = `flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors ${
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
  );
}
