import {
  CreditCard,
  LayoutDashboard,
  Layers,
  ReceiptText,
  Settings2,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavigationItem {
  label: string;
  to: string;
  icon: LucideIcon;
}

export const primaryNavigation: readonly NavigationItem[] = [
  { label: "Overview", to: "/", icon: LayoutDashboard },
  { label: "Customers", to: "/customers", icon: Users },
  { label: "Plans", to: "/plans", icon: Layers },
  { label: "Subscriptions", to: "/subscriptions", icon: CreditCard },
  { label: "Invoices", to: "/invoices", icon: ReceiptText },
];

export const secondaryNavigation: readonly NavigationItem[] = [
  { label: "Settings", to: "/settings", icon: Settings2 },
];

export const allNavigation = [...primaryNavigation, ...secondaryNavigation];

export function getPageTitle(pathname: string): string {
  const match = allNavigation.find((item) =>
    item.to === "/" ? pathname === "/" : pathname.startsWith(item.to),
  );

  return match?.label ?? "Page not found";
}
