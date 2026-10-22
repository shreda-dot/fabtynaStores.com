"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "/reports/sales", label: "Sales summary" },
  { href: "/reports/product-sales", label: "Product sales" },
  { href: "/reports/money-flow", label: "Money flow" },
  { href: "/accounting", label: "Financial position" },
];

export function ReportTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Reports" className="flex gap-2 overflow-x-auto pb-1">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "min-h-11 shrink-0 rounded-md border px-3 py-2 text-sm font-medium",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-surface text-foreground hover:bg-muted",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
