import type { Metadata } from "next";
import Link from "next/link";
import { getMe } from "@/lib/session";
import { Button } from "@/components/ui";
import { PublicHeader } from "@/components/public/public-header";
import { Hero } from "@/components/public/hero";
import { AudienceSplit } from "@/components/public/audience-split";
import { HowItWorks } from "@/components/public/how-it-works";
import { RelationshipSection } from "@/components/public/relationship-section";
import { ShipmentSection } from "@/components/public/shipment-section";
import { PublicFooter } from "@/components/public/public-footer";

export const metadata: Metadata = {
  title: "LoadTopia — The Direct Freight Operating Platform",
  description:
    "Move freight directly with the carriers you choose. Post freight, negotiate privately, book coverage, and manage the shipment in one place.",
  openGraph: {
    title: "LoadTopia — The Direct Freight Operating Platform",
    description:
      "Move freight directly with the carriers you choose. Post freight, negotiate privately, book coverage, and manage the shipment in one place.",
    type: "website",
  },
};

/**
 * Milestone 4 — the public, unauthenticated homepage. Reuses the existing
 * `getMe()` session helper only for the boolean fact a session exists (to
 * swap Sign In for Open Dashboard) — never renders any private company,
 * membership, or freight data. Authenticated visitors are deliberately NOT
 * redirected away; they may still view this page.
 */
export default async function HomePage() {
  const me = await getMe();
  const signedIn = me !== null;

  return (
    <div>
      <PublicHeader signedIn={signedIn} />

      <main>
        <Hero signedIn={signedIn} />
        <AudienceSplit />
        <HowItWorks />
        <RelationshipSection />
        <ShipmentSection />

        <section className="mx-auto max-w-6xl px-5 py-16 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-ink">
            Ready to move freight directly?
          </h2>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
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
        </section>
      </main>

      <PublicFooter signedIn={signedIn} />
    </div>
  );
}
