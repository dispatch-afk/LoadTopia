// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { isYourMove, MarketplaceCard } from "./marketplace-card";
import { buildMarketplaceLoadListItem, buildOfferThreadSummary } from "@/test/fixtures";

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
  "market rate",
];

describe("isYourMove", () => {
  it("is true only when the carrier's own thread is ACTIVE and awaitingMyResponse", () => {
    expect(isYourMove(buildMarketplaceLoadListItem({ myThread: null }))).toBe(false);
    expect(
      isYourMove(
        buildMarketplaceLoadListItem({
          myThread: offerThread({ status: "ACTIVE", awaitingMyResponse: false }),
        }),
      ),
    ).toBe(false);
    expect(
      isYourMove(
        buildMarketplaceLoadListItem({
          myThread: offerThread({ status: "ACTIVE", awaitingMyResponse: true }),
        }),
      ),
    ).toBe(true);
    // A closed thread is never "your move," even if awaitingMyResponse was
    // true at some earlier point.
    expect(
      isYourMove(
        buildMarketplaceLoadListItem({
          myThread: offerThread({ status: "REJECTED", awaitingMyResponse: true }),
        }),
      ),
    ).toBe(false);
  });
});

function offerThread(overrides: Parameters<typeof buildOfferThreadSummary>[0]) {
  return buildOfferThreadSummary(overrides);
}

describe("MarketplaceCard", () => {
  it("shows Your move only when it is genuinely this carrier's turn", () => {
    const l = buildMarketplaceLoadListItem({
      myThread: offerThread({ status: "ACTIVE", awaitingMyResponse: true }),
    });
    render(<MarketplaceCard l={l} />);
    expect(screen.getByText("Your move")).toBeInTheDocument();
  });

  it("shows the thread's own status badge when it is not this carrier's turn", () => {
    const l = buildMarketplaceLoadListItem({
      myThread: offerThread({ status: "ACTIVE", awaitingMyResponse: false }),
    });
    render(<MarketplaceCard l={l} />);
    expect(screen.queryByText("Your move")).not.toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("shows Posted Rate + RPM only when both facts exist, never fabricated", () => {
    const withRate = buildMarketplaceLoadListItem({
      commercialMode: "PUBLISH_RATE",
      postedRate: "1500.00",
      ratePerMile: "1.62",
    });
    const { rerender } = render(<MarketplaceCard l={withRate} />);
    expect(screen.getByText(/1.62\/mi/)).toBeInTheDocument();

    const requestOffers = buildMarketplaceLoadListItem({ commercialMode: "REQUEST_OFFERS" });
    rerender(<MarketplaceCard l={requestOffers} />);
    expect(screen.getByText("Requesting offers")).toBeInTheDocument();
    expect(screen.queryByText(/\/mi/)).not.toBeInTheDocument();
  });

  it("shows the Connected badge only when the shipper is genuinely connected", () => {
    const connected = buildMarketplaceLoadListItem({ shipperIsConnected: true });
    const { rerender } = render(<MarketplaceCard l={connected} />);
    expect(screen.getByText("Connected")).toBeInTheDocument();

    const notConnected = buildMarketplaceLoadListItem({ shipperIsConnected: false });
    rerender(<MarketplaceCard l={notConnected} />);
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
  });

  it("links to the existing /marketplace/:id route", () => {
    const l = buildMarketplaceLoadListItem({ id: "load-99" });
    render(<MarketplaceCard l={l} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/marketplace/load-99");
  });

  it("never renders phantom-signal language", () => {
    const l = buildMarketplaceLoadListItem({
      commercialMode: "PUBLISH_RATE",
      postedRate: "1500.00",
      ratePerMile: "1.62",
      shipperIsConnected: true,
      myThread: offerThread({ status: "ACTIVE", awaitingMyResponse: true }),
    });
    render(<MarketplaceCard l={l} />);
    const body = document.body.textContent?.toLowerCase() ?? "";
    for (const banned of BANNED_WORDS) {
      expect(body).not.toContain(banned);
    }
  });
});
