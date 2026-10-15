import type { ComponentType } from "react";
import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  ClipboardList,
  HandCoins,
  LayoutDashboard,
  Package,
  Receipt,
  Refrigerator,
  ShoppingCart,
  Store,
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
  { label: "Sales", href: "/sales", icon: ShoppingCart, enabled: true },
  { label: "Debtors", href: "/debtors", icon: HandCoins, enabled: true },
  { label: "Customers", href: "/customers", icon: Users, enabled: true },
  { label: "Products", href: "/products", icon: Package, enabled: true },
  { label: "Suppliers", href: "/suppliers", icon: Users, enabled: true },
  { label: "Purchases", href: "/purchases", icon: Store, enabled: true },
  { label: "Fridge (Retail)", href: "/inventory/retail", icon: Refrigerator, enabled: true },
  { label: "Warehouse", href: "/inventory/warehouse", icon: Boxes, enabled: true },
  { label: "Transfers", href: "/transfers", icon: ArrowLeftRight, enabled: true },
  { label: "Adjustments", href: "/adjustments", icon: ClipboardList, enabled: true },
  { label: "Expenses", href: "/expenses", icon: Receipt, enabled: true },
  { label: "Reports", href: "/reports/sales", icon: BarChart3, enabled: true },
];
