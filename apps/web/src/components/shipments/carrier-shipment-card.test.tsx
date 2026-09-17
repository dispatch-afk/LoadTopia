// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CarrierShipmentCard } from "./carrier-shipment-card";
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

describe("CarrierShipmentCard", () => {
  it("renders reference, lane, shipper, rate, status, and nextAction verbatim", () => {
    const s = buildShipmentListItem({
      referenceNumber: "LT-0088",
      origin: { city: "Denver", state: "CO" },
      destination: { city: "Reno", state: "NV" },
      shipperName: "Acme Manufacturing",
      bookedRate: "2100.00",
      status: "PICKED_UP",
      nextAction: "Ready for Transit Update",
    });
    render(<CarrierShipmentCard s={s} />);
    expect(screen.getByText("LT-0088")).toBeInTheDocument();
    expect(screen.getByText(/Denver, CO/)).toBeInTheDocument();
    expect(screen.getByText(/Reno, NV/)).toBeInTheDocument();
    expect(screen.getByText(/Acme Manufacturing/)).toBeInTheDocument();
    expect(screen.getByText(/\$2,100\.00/)).toBeInTheDocument();
    expect(screen.getByText("Picked Up")).toBeInTheDocument();
    expect(screen.getByText("Ready for Transit Update")).toBeInTheDocument();
  });

  it("renders the next action with the same indigo Badge treatment used elsewhere", () => {
    const s = buildShipmentListItem({ nextAction: "POD Needed" });
    render(<CarrierShipmentCard s={s} />);
    expect(screen.getByText("POD Needed").className).toContain("bg-brand-100");
  });

  it("renders pickup and delivery timing", () => {
    const s = buildShipmentListItem();
    render(<CarrierShipmentCard s={s} />);
    expect(screen.getByText(/Pickup:/)).toBeInTheDocument();
    expect(screen.getByText(/Delivery:/)).toBeInTheDocument();
  });

  it("links to the existing unified /marketplace/:id Shipment Detail route", () => {
    const s = buildShipmentListItem({ id: "load-77" });
    render(<CarrierShipmentCard s={s} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/marketplace/load-77");
  });

  it("never adds driver/tractor/trailer/telematics facts not present in the read model", () => {
    const s = buildShipmentListItem();
    render(<CarrierShipmentCard s={s} />);
    const body = document.body.textContent?.toLowerCase() ?? "";
    for (const word of ["driver", "tractor", "trailer", "gps", "eld", "telematics"]) {
      expect(body).not.toContain(word);
    }
  });

  it("never renders phantom-signal language", () => {
    const s = buildShipmentListItem({ nextAction: "Ready for Transit Update" });
    render(<CarrierShipmentCard s={s} />);
    const body = document.body.textContent?.toLowerCase() ?? "";
    for (const banned of BANNED_WORDS) {
      expect(body).not.toContain(banned);
    }
  });
});
