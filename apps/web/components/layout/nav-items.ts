"use client";

import { useSyncExternalStore } from "react";
import type { ComponentType } from "react";
import {
  ArrowLeftRight,
  ArrowRightLeft,
  BarChart3,
  Banknote,
  Boxes,
  Calculator,
  ClipboardList,
  FileText,
  HandCoins,
  Landmark,
  LayoutDashboard,
  Package,
  PackageSearch,
  Receipt,
  Refrigerator,
  ShoppingCart,
  Store,
  Truck,
  Users,
} from "lucide-react";

/** The named sections of the navigation. `undefined` means "no heading". */
export type NavGroupName = "Sell" | "Buy" | "Inventory" | "Money" | "Reports";

export type NavItem = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  enabled: boolean;
  /** Optional group heading. Consecutive items with the same group are shown
   *  together under a single collapsible label. Items without a group are
   *  unlabelled and always visible. */
  group?: NavGroupName;
  /** Match the path exactly. Used for index routes such as /accounting that
   *  would otherwise also match their own children (/accounting/payables). */
  exact?: boolean;
};

export const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, enabled: true, exact: true },

  { label: "Sales", href: "/sales", icon: ShoppingCart, enabled: true, group: "Sell" },
  { label: "Customers", href: "/customers", icon: Users, enabled: true, group: "Sell" },
  { label: "Debtors", href: "/debtors", icon: HandCoins, enabled: true, group: "Sell" },

  { label: "Purchases", href: "/purchases", icon: Store, enabled: true, group: "Buy" },
  { label: "Suppliers", href: "/suppliers", icon: Truck, enabled: true, group: "Buy" },

  { label: "Products", href: "/products", icon: Package, enabled: true, group: "Inventory" },
  { label: "Fridge (Retail)", href: "/inventory/retail", icon: Refrigerator, enabled: true, group: "Inventory" },
  { label: "Warehouse", href: "/inventory/warehouse", icon: Boxes, enabled: true, group: "Inventory" },
  { label: "Transfers", href: "/transfers", icon: ArrowLeftRight, enabled: true, group: "Inventory" },
  { label: "Adjustments", href: "/adjustments", icon: ClipboardList, enabled: true, group: "Inventory" },

  { label: "Expenses", href: "/expenses", icon: Receipt, enabled: true, group: "Money" },
  { label: "Overview", href: "/accounting", icon: Calculator, enabled: true, group: "Money", exact: true },
  { label: "Accounts", href: "/accounting/accounts", icon: Banknote, enabled: true, group: "Money" },
  { label: "Payables", href: "/accounting/payables", icon: FileText, enabled: true, group: "Money" },
  { label: "Loans", href: "/accounting/loans", icon: Landmark, enabled: true, group: "Money" },

  { label: "Sales report", href: "/reports/sales", icon: BarChart3, enabled: true, group: "Reports" },
  { label: "Product sales", href: "/reports/product-sales", icon: PackageSearch, enabled: true, group: "Reports" },
  { label: "Money flow", href: "/reports/money-flow", icon: ArrowRightLeft, enabled: true, group: "Reports" },
];

/** Whether `pathname` belongs to this item: an exact match for index routes,
 *  otherwise the route itself or any child of it. */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.exact === true) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export type NavGroup = {
  /** `null` for the ungrouped items that sit above the first heading. */
  name: NavGroupName | null;
  items: NavItem[];
};

/**
 * Folds the flat list into consecutive groups, preserving order. The first
 * group carries `name: null` for the ungrouped items (Dashboard).
 */
export function groupNavItems(items: NavItem[] = navItems): NavGroup[] {
  const groups: NavGroup[] = [];

  for (const item of items) {
    const name = item.group ?? null;
    const last = groups[groups.length - 1];
    if (last !== undefined && last.name === name) last.items.push(item);
    else groups.push({ name, items: [item] });
  }

  return groups;
}

/** The group holding the active route, or `null` when the active route is
 *  ungrouped (Dashboard) or is not in the navigation at all. */
export function activeNavGroup(pathname: string): NavGroupName | null {
  return navItems.find((item) => isNavItemActive(item, pathname))?.group ?? null;
}

/** A stable DOM-id fragment for a group heading. */
export function navGroupSlug(name: NavGroupName): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

// ---------------------------------------------------------------------------
// Remembered open/closed state, one entry per group.
// ---------------------------------------------------------------------------
// Collapsed is the default, so the list fits without scrolling; the group that
// holds the current page is always expanded by the renderers. The value is read
// through `useSyncExternalStore` rather than an effect so the server and the
// hydrating client agree (both render the collapsed default), and so no state
// is set during an effect. The snapshot keeps a stable identity while storage is
// unchanged — returning a fresh object every call would re-render forever.

const NAV_GROUP_STATE_KEY = "fabtyna-nav-open-groups";
const NO_GROUPS: readonly string[] = [];

let cachedRaw: string | null | undefined;
let cachedGroups: readonly string[] = NO_GROUPS;
const navGroupListeners = new Set<() => void>();

function parseOpenGroups(raw: string | null): readonly string[] {
  if (raw === null) return NO_GROUPS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return NO_GROUPS;
    const names = parsed.filter((value): value is string => typeof value === "string");
    return names.length === 0 ? NO_GROUPS : names;
  } catch {
    return NO_GROUPS;
  }
}

function readOpenGroups(): readonly string[] {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(NAV_GROUP_STATE_KEY);
  } catch {
    raw = null;
  }
  if (raw === cachedRaw) return cachedGroups;
  cachedRaw = raw;
  cachedGroups = parseOpenGroups(raw);
  return cachedGroups;
}

function subscribeNavGroups(onChange: () => void): () => void {
  navGroupListeners.add(onChange);
  // A `storage` event only fires in *other* tabs, which is exactly when this one
  // is out of date; same-tab changes go through `toggleNavGroup` below.
  window.addEventListener("storage", onChange);
  return () => {
    navGroupListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The groups the user opened by hand. Empty until a chevron is clicked. */
export function useOpenNavGroups(): readonly string[] {
  return useSyncExternalStore(subscribeNavGroups, readOpenGroups, () => NO_GROUPS);
}

export function toggleNavGroup(group: NavGroupName): void {
  const open = new Set(readOpenGroups());
  if (!open.delete(group)) open.add(group);

  const next = [...open];
  const serialized = JSON.stringify(next);
  try {
    window.localStorage.setItem(NAV_GROUP_STATE_KEY, serialized);
  } catch {
    /* Storage unavailable (private mode): keep the in-memory value for this page. */
  }

  cachedRaw = serialized;
  cachedGroups = next.length === 0 ? NO_GROUPS : next;
  for (const listener of navGroupListeners) listener();
}
