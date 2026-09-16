// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LoadCard } from "./load-card";
import { buildLoadListItem } from "@/test/fixtures";

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
  "urgent",
  "likely",
];

describe("LoadCard", () => {
  it("renders the server-provided commercialNextAction verbatim — never re-derives it", () => {
    const l = buildLoadListItem({ status: "OFFER_RECEIVED", commercialNextAction: "Review Offers" });
    render(<LoadCard l={l} />);
    expect(screen.getByText("Review Offers")).toBeInTheDocument();
  });

  it("shows Covered — View Shipment copy for a covered load and links to the existing /loads/:id route", () => {
    const l = buildLoadListItem({
      id: "load-42",
      status: "CARRIER_ASSIGNED",
      commercialNextAction: "Covered — View Shipment",
    });
    render(<LoadCard l={l} />);
    expect(screen.getByText("Covered — View Shipment")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/loads/load-42");
  });

  it("hides audience/offer context for a DRAFT load (nothing to show pre-post) and shows it once posted", () => {
    const draft = buildLoadListItem({ status: "DRAFT" });
    const { rerender } = render(<LoadCard l={draft} />);
    expect(screen.queryByText(/offer/)).not.toBeInTheDocument();

    const posted = buildLoadListItem({
      status: "POSTED",
      activeOfferCount: 2,
      audience: { strategy: "MARKETPLACE", currentStage: "MARKETPLACE", nextReleaseAt: null },
    });
    rerender(<LoadCard l={posted} />);
    expect(screen.getByText(/2 offers/)).toBeInTheDocument();
  });

  it("renders lane, pickup window, and equipment", () => {
    const l = buildLoadListItem({
      origin: { city: "Chicago", state: "IL" },
      destination: { city: "Dallas", state: "TX" },
      equipmentType: "REEFER",
    });
    render(<LoadCard l={l} />);
    expect(screen.getByText(/Chicago, IL/)).toBeInTheDocument();
    expect(screen.getByText(/Dallas, TX/)).toBeInTheDocument();
    expect(screen.getByText("Reefer")).toBeInTheDocument();
  });

  it("never renders phantom-signal language", () => {
    const l = buildLoadListItem({ commercialNextAction: "Review Offers" });
    render(<LoadCard l={l} />);
    const body = document.body.textContent?.toLowerCase() ?? "";
    for (const banned of BANNED_WORDS) {
      expect(body).not.toContain(banned);
    }
  });
});
