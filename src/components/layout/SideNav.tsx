import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { navItemsForRole } from "./nav";
import { cn } from "@/lib/utils";

export function SideNav() {
  const { role } = useAuth();
  const [location] = useLocation();
  const items = navItemsForRole(role);

  return (
    <nav className="flex w-56 shrink-0 flex-col gap-1 border-r border-border bg-mist/40 p-3">
      {items.map((item) => {
        const active = location.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-background text-emerald-strong shadow-sm ring-1 ring-border"
                : "text-foreground/70 hover:bg-background hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
