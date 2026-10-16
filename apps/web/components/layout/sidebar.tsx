"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Package } from "lucide-react";
import { navItems } from "./nav-items";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
      <Link
        href="/dashboard"
        className="flex h-16 shrink-0 items-center gap-3 border-b border-sidebar-border px-5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Package aria-hidden="true" className="h-5 w-5" />
        </span>
        <span className="text-base font-semibold tracking-tight">Fabtyna Stores</span>
      </Link>
      <nav aria-label="Main navigation" className="flex-1 space-y-1 overflow-y-auto p-3">
        {navItems.map((item, index) => {
          const Icon = item.icon;
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const className = `flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors ${
            active
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : item.enabled
                ? "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                : "cursor-not-allowed text-sidebar-foreground/50"
          }`;
          const showGroup = item.group !== undefined && item.group !== navItems[index - 1]?.group;

          return (
            <div key={item.href}>
              {showGroup && (
                <p className="px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/50">
                  {item.group}
                </p>
              )}
              {item.enabled ? (
                <Link href={item.href} aria-current={active ? "page" : undefined} className={className}>
                  <Icon aria-hidden="true" className="h-5 w-5 shrink-0" />
                  {item.label}
                </Link>
              ) : (
                <span aria-disabled="true" className={className} title="Not available yet">
                  <Icon aria-hidden="true" className="h-5 w-5 shrink-0" />
                  {item.label}
                </span>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
