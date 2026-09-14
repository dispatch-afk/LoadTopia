import { describe, expect, it } from "vitest";
import { shipmentNextAction } from "./shipment-next-action";

describe("shipmentNextAction", () => {
  it("is factual and role-specific at each shipment status", () => {
    expect(shipmentNextAction("AWARDED", "shipper")).toBe("Confirm carrier assignment");
    expect(shipmentNextAction("AWARDED", "carrier")).toBe("Awaiting assignment");
    expect(shipmentNextAction("CARRIER_ASSIGNED", "carrier")).toBe("Confirm pickup");
    expect(shipmentNextAction("CARRIER_ASSIGNED", "shipper")).toBe("Awaiting pickup");
    expect(shipmentNextAction("IN_TRANSIT", "carrier")).toBe("Mark delivered");
    expect(shipmentNextAction("DELIVERED", "carrier")).toBe("Upload POD");
    expect(shipmentNextAction("DELIVERED", "shipper")).toBe("Review POD");
    expect(shipmentNextAction("COMPLETED", "shipper")).toBe("Completed");
    expect(shipmentNextAction("COMPLETED", "carrier")).toBe("Completed");
  });

  it("never invents urgency language for any status/side combination", () => {
    const statuses = [
      "AWARDED",
      "CARRIER_ASSIGNED",
      "PICKED_UP",
      "IN_TRANSIT",
      "DELIVERED",
      "COMPLETED",
      "CANCELLED",
    ] as const;
    const banned = /hot|urgent|priority|likely late|recommended/i;
    for (const status of statuses) {
      for (const side of ["shipper", "carrier"] as const) {
        expect(shipmentNextAction(status, side)).not.toMatch(banned);
      }
    }
  });

  it("falls back to a plain dash for a non-shipment status", () => {
    expect(shipmentNextAction("DRAFT", "shipper")).toBe("—");
    expect(shipmentNextAction("POSTED", "carrier")).toBe("—");
  });
});
