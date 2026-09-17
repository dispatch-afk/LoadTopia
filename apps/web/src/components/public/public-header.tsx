import Link from "next/link";
import { Brand } from "./brand";
import { MobileNav } from "./mobile-nav";
import { Button } from "@/components/ui";

/**
 * Public homepage header. Server-rendered except for the small `MobileNav`
 * client island. `signedIn` is the ONLY session-derived fact used here —
 * never the underlying `MeResponse` — so no private company/user data ever
 * reaches public HTML.
 */
export function PublicHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="relative border-b border-line bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <Brand />

        <nav aria-label="Primary" className="hidden items-center gap-6 md:flex">
          <Link href="#shippers" className="text-sm font-medium text-slate-600 hover:text-ink">
            For Shippers
          </Link>
          <Link href="#carriers" className="text-sm font-medium text-slate-600 hover:text-ink">
            For Carriers
          </Link>
          <Link
            href={signedIn ? "/dashboard" : "/login"}
            className="text-sm font-medium text-slate-600 hover:text-ink"
          >
            {signedIn ? "Open Dashboard" : "Sign In"}
          </Link>
          <Link href="/register">
            <Button>Get Started</Button>
          </Link>
        </nav>

        <MobileNav signedIn={signedIn} />
      </div>
    </header>
  );
}
