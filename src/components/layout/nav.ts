import { GraduationCap, LayoutDashboard, Users, type LucideIcon } from "lucide-react";
import type { AppRole } from "@/lib/types";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Roles allowed to see this nav item. */
  roles: AppRole[];
}

/**
 * Single source of truth for the left-nav. Items are filtered by the current
 * user's role at render time. Routes marked as placeholders in Prompt 1 still
 * appear here so the shell is navigable.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    label: "Programs",
    href: "/trainer/programs",
    icon: LayoutDashboard,
    roles: ["admin", "trainer"],
  },
  {
    label: "My Learning",
    href: "/trainee/learning",
    icon: GraduationCap,
    roles: ["trainee"],
  },
  {
    label: "Users",
    href: "/admin/users",
    icon: Users,
    roles: ["admin"],
  },
];

export function navItemsForRole(role: AppRole | null): NavItem[] {
  if (!role) return [];
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
