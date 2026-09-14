// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LoadEventView } from "@loadtopia/shared";
import { ShipmentTimeline } from "./shipment-timeline";

function event(overrides: Partial<LoadEventView> = {}): LoadEventView {
  return {
    id: "evt-1",
    type: "STATUS_CHANGED",
    fromStatus: "POSTED",
    toStatus: "AWARDED",
    actorUserId: "user-1",
    actorName: "Riley Shipper",
    note: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ShipmentTimeline", () => {
  it("shows a truthful empty state rather than a blank card", () => {
    render(<ShipmentTimeline events={[]} />);
    expect(screen.getByText(/no history yet/i)).toBeInTheDocument();
  });

  it("renders each event's label, transition, and actor", () => {
    render(<ShipmentTimeline events={[event()]} />);
    expect(screen.getByText(/Posted → Awarded/)).toBeInTheDocument();
    expect(screen.getByText(/Riley Shipper/)).toBeInTheDocument();
  });

  it("never invents an actor — a redacted (null) actorName renders no name, not a placeholder", () => {
    render(<ShipmentTimeline events={[event({ actorName: null, actorUserId: null })]} />);
    expect(screen.queryByText("Riley Shipper")).not.toBeInTheDocument();
    expect(screen.queryByText(/unknown/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/system/i)).not.toBeInTheDocument();
  });

  it("shows the note text when present", () => {
    render(<ShipmentTimeline events={[event({ note: "customer requested cancellation" })]} />);
    expect(screen.getByText(/customer requested cancellation/)).toBeInTheDocument();
  });
});
