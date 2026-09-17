import Link from "next/link";
import { Brand } from "./brand";

/**
 * Minimal, truthful footer (Milestone 4 public site). No Privacy/Terms/
 * About/Contact links — none of those routes exist. Do not add them here
 * without first building the actual page.
 */
export function PublicFooter({ signedIn }: { signedIn: boolean }) {
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8">
        <Brand size="sm" />
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-5 text-sm">
          <Link href="#shippers" className="text-muted hover:text-ink">
            For Shippers
          </Link>
          <Link href="#carriers" className="text-muted hover:text-ink">
            For Carriers
          </Link>
          <Link href={signedIn ? "/dashboard" : "/login"} className="text-muted hover:text-ink">
            {signedIn ? "Open Dashboard" : "Sign In"}
          </Link>
          <Link href="/register" className="font-medium text-brand-600 hover:underline">
            Get Started
          </Link>
        </nav>
      </div>
    </footer>
  );
}
