import { type ReactNode } from "react";
import { TopBar } from "./TopBar";
import { SideNav } from "./SideNav";

/** Authenticated app shell: top bar + role-filtered left nav + content. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopBar />
      <div className="flex flex-1">
        <SideNav />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
