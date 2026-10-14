import type { ComponentType } from "react";
import {
  ArrowLeftRight,
  Boxes,
  ClipboardList,
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  enabled: boolean;
};

export const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, enabled: true },
  { label: "Products", href: "/products", icon: Package, enabled: true },
  { label: "Suppliers", href: "/suppliers", icon: Users, enabled: true },
  { label: "Purchases", href: "/purchases", icon: ShoppingCart, enabled: false },
  { label: "Stock", href: "/stock", icon: Boxes, enabled: false },
  { label: "Transfers", href: "/transfers", icon: ArrowLeftRight, enabled: false },
  { label: "Adjustments", href: "/adjustments", icon: ClipboardList, enabled: false },
];
