import { Wordmark } from "./Wordmark";
import { BrandLogo } from "./BrandLogo";

/**
 * App header: the "Venakan Learn" product wordmark on the left, the Venakan
 * Info Solutions company logo on the right. The user/profile menu lives at the
 * bottom of the left nav (see SideNav).
 */
export function TopBar() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-4">
      <Wordmark />
      <BrandLogo className="h-7" />
    </header>
  );
}
