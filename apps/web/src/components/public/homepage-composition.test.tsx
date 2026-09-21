// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PublicHeader } from "./public-header";
import { Hero } from "./hero";
import { AudienceSplit } from "./audience-split";
import { HowItWorks } from "./how-it-works";
import { RelationshipSection } from "./relationship-section";
import { ShipmentSection } from "./shipment-section";
import { PublicFooter } from "./public-footer";

/**
 * Milestone 4 — renders the full public-homepage composition exactly as
 * `app/page.tsx` assembles it (that file itself is an async server
 * component calling `getMe()`, so it is exercised via its own sub-
 * components here, matching this codebase's established convention of not
 * unit-testing async Next.js server pages directly). Guards two locked
 * requirements at once: exactly one H1 across the whole page, and a broad
 * phantom/fake-proof-claim regression scoped to the actual public copy.
 */
function Homepage({ signedIn }: { signedIn: boolean }) {
  return (
    <div>
      <PublicHeader signedIn={signedIn} />
      <main>
        <Hero signedIn={signedIn} />
        <AudienceSplit />
        <HowItWorks />
        <RelationshipSection />
        <ShipmentSection />
      </main>
      <PublicFooter signedIn={signedIn} />
    </div>
  );
}

// Multi-word or otherwise unambiguous phrases — safe to check as plain
// substrings against the lowercased page text.
const BANNED_PHRASES = [
  "know the market",
  "live rate",
  "market rate",
  "truckstop",
  "rate intelligence",
  "ai-powered",
  "smart matching",
  "predictive",
  "qualified carriers",
  "trusted by",
  "10,000+",
  "save 30%",
  "instant payments",
  "get paid",
  "settlement",
  "invoicing",
  "performance dashboard",
  "benchmark",
  "guaranteed capacity",
  "preferred pricing",
  "fmcsa",
  "insurance verif",
  "telematics",
  "testimonial",
];

// Short tokens that are real substrings of legitimate words already in this
// page's copy ("update", "updates") — matched as whole words only, so the
// test stays robust to accidental reintroduction without being brittle to
// ordinary copy like "delivery updates".
const BANNED_WORDS = [/\bdat\b/i, /\beld\b/i, /\bgps\b/i];

describe("Public homepage composition", () => {
  it("has exactly one H1, and it is the locked positioning", () => {
    render(<Homepage signedIn={false} />);
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent("The Direct Freight Operating Platform");
  });

  it.each([["signed out", false] as const, ["signed in", true] as const])(
    "never contains any banned market/AI/payment/reporting/proof claim (%s)",
    (_label, signedIn) => {
      render(<Homepage signedIn={signedIn} />);
      const body = document.body.textContent?.toLowerCase().replace(/\s+/g, " ") ?? "";
      for (const claim of BANNED_PHRASES) {
        expect(body).not.toContain(claim);
      }
      for (const pattern of BANNED_WORDS) {
        expect(body).not.toMatch(pattern);
      }
    },
  );

  it("does not render the authenticated app shell (no company switcher, no sidebar nav)", () => {
    render(<Homepage signedIn={true} />);
    expect(screen.queryByText("Active company")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Active company")).not.toBeInTheDocument();
  });

  it("mentions only real, implemented capability language", () => {
    render(<Homepage signedIn={false} />);
    const body = document.body.textContent?.toLowerCase() ?? "";
    for (const real of ["post freight", "negotiate", "carrier network", "posted rate", "proof of delivery"]) {
      expect(body).toContain(real);
    }
  });
});
