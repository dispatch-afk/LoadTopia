import Link from "next/link";
import { Button } from "@/components/ui";

/**
 * Locked positioning (Milestone 4): the headline and supporting copy map
 * directly to implemented product only — no live market pricing, no AI, no
 * fabricated proof. See the M4 Public Website inspection report for the
 * truthfulness review behind this exact wording.
 */
export function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">LoadTopia</p>
      <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
        The Direct Freight Operating Platform
      </h1>
      <p className="mt-5 max-w-2xl text-lg text-muted">
        Move freight directly with the carriers you choose. Post freight, negotiate privately, book
        coverage, and manage the shipment in one place.
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        {signedIn ? (
          <Link href="/dashboard">
            <Button>Open Dashboard</Button>
          </Link>
        ) : (
          <>
            <Link href="/register?type=shipper">
              <Button>Post Your First Load</Button>
            </Link>
            <Link href="/register?type=carrier">
              <Button variant="secondary">Find Freight</Button>
            </Link>
          </>
        )}
      </div>

      {/* Restrained inline route/network motif — decorative only. */}
      <svg
        className="mt-16 h-auto w-full max-w-2xl text-brand-200"
        viewBox="0 0 640 120"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M10 100 C 160 20, 260 20, 320 60 S 480 100, 630 30"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray="1 10"
          strokeLinecap="round"
        />
        <circle cx="10" cy="100" r="5" fill="currentColor" />
        <circle cx="320" cy="60" r="5" fill="currentColor" />
        <circle cx="630" cy="30" r="5" fill="currentColor" />
      </svg>
    </section>
  );
}
