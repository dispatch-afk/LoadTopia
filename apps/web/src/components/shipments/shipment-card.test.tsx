// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShipmentCard } from "./shipment-card";
import { buildShipmentListItem } from "@/test/fixtures";

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

describe("ShipmentCard", () => {
  it("renders reference, lane, carrier, status, and nextAction verbatim", () => {
    const s = buildShipmentListItem({
      referenceNumber: "LT-0042",
      origin: { city: "Chicago", state: "IL" },
      destination: { city: "Dallas", state: "TX" },
      carrierName: "Longhorn Transportation",
      status: "IN_TRANSIT",
      nextAction: "Awaiting Delivery Confirmation",
    });
    render(<ShipmentCard s={s} />);
    expect(screen.getByText("LT-0042")).toBeInTheDocument();
    expect(screen.getByText(/Chicago, IL/)).toBeInTheDocument();
    expect(screen.getByText(/Dallas, TX/)).toBeInTheDocument();
    expect(screen.getByText(/Longhorn Transportation/)).toBeInTheDocument();
    expect(screen.getByText("In Transit")).toBeInTheDocument();
    expect(screen.getByText("Awaiting Delivery Confirmation")).toBeInTheDocument();
  });

  it("renders the next action with the same indigo Badge treatment used elsewhere", () => {
    const s = buildShipmentListItem({ nextAction: "Awaiting Pickup" });
    render(<ShipmentCard s={s} />);
    expect(screen.getByText("Awaiting Pickup").className).toContain("bg-brand-100");
  });

  it("renders pickup and delivery timing", () => {
    const s = buildShipmentListItem();
    render(<ShipmentCard s={s} />);
    expect(screen.getByText(/Pickup:/)).toBeInTheDocument();
    expect(screen.getByText(/Delivery:/)).toBeInTheDocument();
  });

  it("handles a missing carrier/rate gracefully", () => {
    const s = buildShipmentListItem({ carrierName: null, carrierCompanyId: null, bookedRate: null });
    render(<ShipmentCard s={s} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("links to the existing unified /loads/:id Shipment Detail route", () => {
    const s = buildShipmentListItem({ id: "load-99" });
    render(<ShipmentCard s={s} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/loads/load-99");
  });

  it("never renders phantom-signal language", () => {
    const s = buildShipmentListItem({ nextAction: "Awaiting Delivery Confirmation" });
    render(<ShipmentCard s={s} />);
    const body = document.body.textContent?.toLowerCase() ?? "";
    for (const banned of BANNED_WORDS) {
      expect(body).not.toContain(banned);
    }
  });
});
