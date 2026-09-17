// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OfferCard, isMyOfferMove } from "./offer-card";
import { buildOfferThreadSummary } from "@/test/fixtures";

const BANNED_WORDS = [
  "hot",
  "trending",
  "high demand",
  "popular",
  "great rate",
  "best match",
  "recommended",
  "top load",
  "top carrier",
  "outbid",
  "you are likely to win",
];

describe("isMyOfferMove", () => {
  it("is true only when the thread is ACTIVE and awaitingMyResponse", () => {
    expect(isMyOfferMove(buildOfferThreadSummary({ status: "ACTIVE", awaitingMyResponse: false }))).toBe(
      false,
    );
    expect(isMyOfferMove(buildOfferThreadSummary({ status: "ACTIVE", awaitingMyResponse: true }))).toBe(
      true,
    );
    // A closed thread is never "your move," even if awaitingMyResponse was
    // true at some earlier point (matches the analogous MarketplaceCard rule).
    expect(
      isMyOfferMove(buildOfferThreadSummary({ status: "REJECTED", awaitingMyResponse: true })),
    ).toBe(false);
  });
});

describe("OfferCard", () => {
  it("renders the load reference and lane from the widened read model", () => {
    const t = buildOfferThreadSummary({
      load: {
        referenceNumber: "LT-0055",
        origin: { city: "Austin", state: "TX" },
        destination: { city: "Tulsa", state: "OK" },
      },
    });
    render(<OfferCard t={t} />);
    expect(screen.getByText("LT-0055")).toBeInTheDocument();
    expect(screen.getByText(/Austin, TX/)).toBeInTheDocument();
    expect(screen.getByText(/Tulsa, OK/)).toBeInTheDocument();
  });

  it("renders this carrier's own current offer amount", () => {
    const t = buildOfferThreadSummary({ currentAmount: "1750.00", currentCurrency: "USD" });
    render(<OfferCard t={t} />);
    expect(screen.getByText(/\$1,750\.00/)).toBeInTheDocument();
  });

  it("shows Your move only when genuinely authoritative, and hides the redundant status badge", () => {
    const t = buildOfferThreadSummary({ status: "ACTIVE", awaitingMyResponse: true });
    render(<OfferCard t={t} />);
    expect(screen.getByText("Your move")).toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
  });

  it("shows the factual thread status when it is not this carrier's turn", () => {
    const t = buildOfferThreadSummary({ status: "ACTIVE", awaitingMyResponse: false });
    render(<OfferCard t={t} />);
    expect(screen.queryByText("Your move")).not.toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("a rejected/closed thread never fabricates Your move", () => {
    const t = buildOfferThreadSummary({ status: "REJECTED", awaitingMyResponse: true });
    render(<OfferCard t={t} />);
    expect(screen.queryByText("Your move")).not.toBeInTheDocument();
    expect(screen.getByText("Rejected")).toBeInTheDocument();
  });

  it("links to the existing /marketplace/:loadId route", () => {
    const t = buildOfferThreadSummary({ loadId: "load-42" });
    render(<OfferCard t={t} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/marketplace/load-42");
  });

  it("never renders any winner/competitor field — none exists on the props type", () => {
    const t = buildOfferThreadSummary();
    render(<OfferCard t={t} />);
    const body = document.body.textContent?.toLowerCase() ?? "";
    for (const word of ["winner", "winning", "competitor", "competing", "rate confirmation"]) {
      expect(body).not.toContain(word);
    }
  });

  it("never renders phantom-signal language", () => {
    const t = buildOfferThreadSummary({ status: "ACTIVE", awaitingMyResponse: true });
    render(<OfferCard t={t} />);
    const body = document.body.textContent?.toLowerCase() ?? "";
    for (const banned of BANNED_WORDS) {
      expect(body).not.toContain(banned);
    }
  });
});
