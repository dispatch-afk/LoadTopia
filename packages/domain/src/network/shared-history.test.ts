import { describe, expect, it } from "vitest";
import { summarizeSharedHistory } from "./shared-history";

describe("summarizeSharedHistory", () => {
  it("shapes zero history truthfully (no fields fabricated)", () => {
    expect(
      summarizeSharedHistory({ totalCount: 0, completedCount: 0, activeCount: 0, lastAwardedAt: null }),
    ).toEqual({
      shipmentsTogether: 0,
      completedShipments: 0,
      activeShipments: 0,
      lastWorkedTogether: null,
    });
  });

  it("passes through counts and formats the last-awarded date as ISO", () => {
    const date = new Date("2026-08-15T12:00:00.000Z");
    expect(
      summarizeSharedHistory({ totalCount: 5, completedCount: 3, activeCount: 1, lastAwardedAt: date }),
    ).toEqual({
      shipmentsTogether: 5,
      completedShipments: 3,
      activeShipments: 1,
      lastWorkedTogether: date.toISOString(),
    });
  });
});
