import { Link, useLocation } from "wouter";
import { ChevronDown, LogOut, Settings } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { navItemsForRole } from "./nav";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_LABELS } from "@/lib/types";

export function SideNav() {
  const { role } = useAuth();
  const [location] = useLocation();
  const items = navItemsForRole(role);

  return (
    <nav className="flex w-56 shrink-0 flex-col border-r border-border bg-mist/40 p-3">
      <div className="flex flex-1 flex-col gap-1">
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
      </div>

      <UserMenu />
    </nav>
  );
}

function UserMenu() {
  const { profile, role, signOut } = useAuth();
  const [, navigate] = useLocation();

  const initials = (profile?.full_name || profile?.email || "?")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="mt-2 border-t border-border pt-2">
      <DropdownMenu>
        <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-background focus:outline-none focus:ring-2 focus:ring-ring">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">
            {initials}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate leading-tight">
              {profile?.full_name || profile?.email}
            </span>
            {role && (
              <span className="block text-xs text-muted-foreground">
                {ROLE_LABELS[role]}
              </span>
            )}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-52">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col">
              <span className="text-sm font-medium">{profile?.full_name}</span>
              <span className="text-xs text-muted-foreground">
                {profile?.email}
              </span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate("/settings")}>
            <Settings className="h-4 w-4" />
            Profile settings
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void signOut()}>
            <LogOut className="h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
