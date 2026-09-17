"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui";

/**
 * Small, isolated client boundary for the public header's mobile menu — the
 * rest of the homepage stays a server component. Mirrors the accessible
 * disclosure pattern already proven by the authenticated app shell's mobile
 * menu (Milestone 4 Phase 11): a plain toggle button with `aria-expanded`/
 * `aria-controls`, not a modal, so no focus trap is needed.
 */
export function MobileNav({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="public-mobile-nav-panel"
        onClick={() => setOpen((o) => !o)}
        className="lt-focus rounded-lg border border-line p-2.5 text-slate-600 hover:bg-slate-50"
      >
        <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          {open ? (
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          ) : (
            <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          )}
        </svg>
      </button>

      {open && (
        <div
          id="public-mobile-nav-panel"
          className="absolute inset-x-0 top-full z-20 border-b border-line bg-white px-4 py-3 shadow-sm"
        >
          <nav aria-label="Public" className="flex flex-col gap-1">
            <Link
              href="#shippers"
              onClick={close}
              className="lt-focus rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-ink"
            >
              For Shippers
            </Link>
            <Link
              href="#carriers"
              onClick={close}
              className="lt-focus rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-ink"
            >
              For Carriers
            </Link>
            <Link
              href={signedIn ? "/dashboard" : "/login"}
              onClick={close}
              className="lt-focus rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-ink"
            >
              {signedIn ? "Open Dashboard" : "Sign In"}
            </Link>
          </nav>
          <div className="mt-2">
            <Link href="/register" onClick={close}>
              <Button className="w-full">Get Started</Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
