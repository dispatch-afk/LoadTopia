import { LoadStatus } from "@loadtopia/shared";
import { describe, expect, it } from "vitest";
import { commercialNextAction } from "./commercial-next-action";

describe("commercialNextAction", () => {
  it("is factual and deterministic for every LoadStatus", () => {
    expect(commercialNextAction(LoadStatus.DRAFT)).toBe("Finish Draft");
    expect(commercialNextAction(LoadStatus.POSTED)).toBe("Awaiting Coverage");
    expect(commercialNextAction(LoadStatus.OFFER_RECEIVED)).toBe("Review Offers");
    expect(commercialNextAction(LoadStatus.AWARDED)).toBe("Covered — View Shipment");
    expect(commercialNextAction(LoadStatus.CARRIER_ASSIGNED)).toBe("Covered — View Shipment");
    expect(commercialNextAction(LoadStatus.PICKED_UP)).toBe("Covered — View Shipment");
    expect(commercialNextAction(LoadStatus.IN_TRANSIT)).toBe("Covered — View Shipment");
    expect(commercialNextAction(LoadStatus.DELIVERED)).toBe("Covered — View Shipment");
    expect(commercialNextAction(LoadStatus.COMPLETED)).toBe("Completed");
    expect(commercialNextAction(LoadStatus.CANCELLED)).toBe("Cancelled");
  });

  it("covers every currently defined LoadStatus value — fails if a new status is added without updating this helper", () => {
    const allStatuses = Object.values(LoadStatus);
    for (const status of allStatuses) {
      expect(() => commercialNextAction(status)).not.toThrow();
      expect(typeof commercialNextAction(status)).toBe("string");
    }
    // Exactly the 10 statuses this test enumerates above — if this fails,
    // a new LoadStatus was added and commercialNextAction needs a new case
    // (TypeScript's exhaustiveness check in the implementation already
    // enforces this at compile time; this is the runtime confirmation).
    expect(allStatuses).toHaveLength(10);
  });

  it("never invents urgency, priority, or scarcity language for any status", () => {
    const banned = /hot|urgent|priority|likely late|recommended|best|top|trending/i;
    for (const status of Object.values(LoadStatus)) {
      expect(commercialNextAction(status)).not.toMatch(banned);
    }
  });

  it("every covered (AWARDED..DELIVERED) status produces the identical shipment-continuity copy", () => {
    const covered = [
      LoadStatus.AWARDED,
      LoadStatus.CARRIER_ASSIGNED,
      LoadStatus.PICKED_UP,
      LoadStatus.IN_TRANSIT,
      LoadStatus.DELIVERED,
    ] as const;
    const results = new Set(covered.map((s) => commercialNextAction(s)));
    expect(results.size).toBe(1);
    expect([...results][0]).toBe("Covered — View Shipment");
  });
});
