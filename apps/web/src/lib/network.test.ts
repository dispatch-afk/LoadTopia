import { describe, expect, it } from "vitest";
import { counterpartNoun, laneLabel, networkAreaLabel, sharedHistoryHeadline } from "./network";

describe("networkAreaLabel", () => {
  it("labels the workspace by company type", () => {
    expect(networkAreaLabel("CARRIER")).toBe("Connections");
    expect(networkAreaLabel("SHIPPER")).toBe("Carrier Network");
    expect(networkAreaLabel(null)).toBe("Carrier Network");
  });
});

describe("counterpartNoun", () => {
  it("names the other side of the relationship", () => {
    expect(counterpartNoun("CARRIER")).toBe("shipper");
    expect(counterpartNoun("SHIPPER")).toBe("carrier");
  });
});

describe("laneLabel", () => {
  it("formats origin -> destination", () => {
    expect(
      laneLabel({ origin: { city: "Chicago", state: "IL" }, destination: { city: "Dallas", state: "TX" } }),
    ).toBe("Chicago, IL → Dallas, TX");
  });
});

describe("sharedHistoryHeadline", () => {
  it("is empty for a pair with zero verified history — never fabricated", () => {
    expect(
      sharedHistoryHeadline({ shipmentsTogether: 0, completedShipments: 0, activeShipments: 0, lastWorkedTogether: null }),
    ).toBe("");
  });

  it("reports completed shipments together", () => {
    expect(
      sharedHistoryHeadline({ shipmentsTogether: 3, completedShipments: 3, activeShipments: 0, lastWorkedTogether: null }),
    ).toBe("3 completed shipments together");
    expect(
      sharedHistoryHeadline({ shipmentsTogether: 1, completedShipments: 1, activeShipments: 0, lastWorkedTogether: null }),
    ).toBe("1 completed shipment together");
  });

  it("reports in-progress shared shipments when none are completed yet", () => {
    expect(
      sharedHistoryHeadline({ shipmentsTogether: 1, completedShipments: 0, activeShipments: 1, lastWorkedTogether: null }),
    ).toBe("1 shipment together, in progress");
  });
});
