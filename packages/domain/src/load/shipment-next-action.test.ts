import { describe, expect, it } from "vitest";
import { deriveShipmentPodState, shipmentNextAction } from "./shipment-next-action";

describe("shipmentNextAction", () => {
  it("is factual and role-specific at each shipment status", () => {
    expect(shipmentNextAction("AWARDED", "shipper")).toBe("Confirm carrier assignment");
    expect(shipmentNextAction("AWARDED", "carrier")).toBe("Awaiting assignment");
    expect(shipmentNextAction("CARRIER_ASSIGNED", "carrier")).toBe("Confirm pickup");
    expect(shipmentNextAction("CARRIER_ASSIGNED", "shipper")).toBe("Awaiting pickup");
    expect(shipmentNextAction("IN_TRANSIT", "carrier")).toBe("Mark delivered");
    expect(shipmentNextAction("DELIVERED", "carrier")).toBe("Upload POD");
    expect(shipmentNextAction("DELIVERED", "shipper")).toBe("Awaiting POD");
    expect(shipmentNextAction("COMPLETED", "shipper")).toBe("Completed");
    expect(shipmentNextAction("COMPLETED", "carrier")).toBe("Completed");
  });

  it("distinguishes every POD state at DELIVERED, for both sides", () => {
    expect(shipmentNextAction("DELIVERED", "carrier", "NONE")).toBe("Upload POD");
    expect(shipmentNextAction("DELIVERED", "shipper", "NONE")).toBe("Awaiting POD");
    expect(shipmentNextAction("DELIVERED", "carrier", "PENDING_REVIEW")).toBe(
      "Awaiting shipper POD review",
    );
    expect(shipmentNextAction("DELIVERED", "shipper", "PENDING_REVIEW")).toBe("Review POD");
    expect(shipmentNextAction("DELIVERED", "carrier", "REJECTED")).toBe(
      "Upload replacement POD",
    );
    expect(shipmentNextAction("DELIVERED", "shipper", "REJECTED")).toBe(
      "Awaiting replacement POD",
    );
    expect(shipmentNextAction("DELIVERED", "carrier", "APPROVED")).toBe(
      "POD approved — awaiting shipper completion",
    );
    expect(shipmentNextAction("DELIVERED", "shipper", "APPROVED")).toBe("Complete shipment");
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

describe("deriveShipmentPodState", () => {
  // Small builder to keep the 12 required cases readable — `days` offsets
  // createdAt so ordering ("older"/"newer") is explicit and unambiguous.
  function pod(
    reviewStatus: "PENDING_REVIEW" | "REJECTED" | "APPROVED",
    opts: { days?: number; removed?: boolean; docType?: string; unconfirmed?: boolean } = {},
  ) {
    const day = 1 + (opts.days ?? 0);
    return {
      docType: opts.docType ?? "POD",
      reviewStatus,
      confirmedAt: opts.unconfirmed ? null : `2026-01-${String(day).padStart(2, "0")}`,
      removedAt: opts.removed ? `2026-02-01` : null,
      createdAt: `2026-01-${String(day).padStart(2, "0")}`,
    };
  }

  it("1. no POD at all -> NONE", () => {
    expect(deriveShipmentPodState([])).toBe("NONE");
  });

  it("2. one PENDING_REVIEW POD -> PENDING_REVIEW", () => {
    expect(deriveShipmentPodState([pod("PENDING_REVIEW")])).toBe("PENDING_REVIEW");
  });

  it("3. one REJECTED POD -> REJECTED", () => {
    expect(deriveShipmentPodState([pod("REJECTED")])).toBe("REJECTED");
  });

  it("4. rejected (older) + pending replacement (newer) -> PENDING_REVIEW", () => {
    const older = pod("REJECTED", { days: 0 });
    const newer = pod("PENDING_REVIEW", { days: 1 });
    expect(deriveShipmentPodState([older, newer])).toBe("PENDING_REVIEW");
    expect(deriveShipmentPodState([newer, older])).toBe("PENDING_REVIEW"); // order-independent
  });

  it("5. rejected (older) + approved replacement (newer) -> APPROVED", () => {
    const older = pod("REJECTED", { days: 0 });
    const newer = pod("APPROVED", { days: 1 });
    expect(deriveShipmentPodState([older, newer])).toBe("APPROVED");
  });

  it("6. one APPROVED POD -> APPROVED", () => {
    expect(deriveShipmentPodState([pod("APPROVED")])).toBe("APPROVED");
  });

  it("7. APPROVED (older) + a later, unrelated PENDING_REVIEW POD -> APPROVED (the approval dominates)", () => {
    const approved = pod("APPROVED", { days: 0 });
    const laterPending = pod("PENDING_REVIEW", { days: 1 });
    expect(deriveShipmentPodState([approved, laterPending])).toBe("APPROVED");
    expect(deriveShipmentPodState([laterPending, approved])).toBe("APPROVED"); // order-independent
  });

  it("8. APPROVED (older) + a later, unrelated REJECTED POD -> APPROVED (the approval dominates)", () => {
    const approved = pod("APPROVED", { days: 0 });
    const laterRejected = pod("REJECTED", { days: 1 });
    expect(deriveShipmentPodState([approved, laterRejected])).toBe("APPROVED");
  });

  it("9. multiple APPROVED PODs -> APPROVED", () => {
    expect(
      deriveShipmentPodState([pod("APPROVED", { days: 0 }), pod("APPROVED", { days: 1 })]),
    ).toBe("APPROVED");
  });

  it("10. a removed APPROVED POD (hypothetical — approved PODs are never actually removable by product rule) never dominates; an active PENDING_REVIEW POD is evaluated truthfully", () => {
    // The boundary asserted here: deriveShipmentPodState trusts its `removedAt`
    // input completely — the guarantee that an APPROVED POD is never actually
    // removed lives in DocumentsService#remove (a terminal-review guard), not
    // in this pure function. This case proves the function's OWN filtering is
    // correct even if it were ever handed a removed-APPROVED row.
    const removedApproved = pod("APPROVED", { days: 0, removed: true });
    const activePending = pod("PENDING_REVIEW", { days: 1 });
    expect(deriveShipmentPodState([removedApproved, activePending])).toBe("PENDING_REVIEW");
  });

  it("11. a removed APPROVED POD + an active REJECTED POD -> REJECTED (the removed approval never participates)", () => {
    const removedApproved = pod("APPROVED", { days: 0, removed: true });
    const activeRejected = pod("REJECTED", { days: 1 });
    expect(deriveShipmentPodState([removedApproved, activeRejected])).toBe("REJECTED");
  });

  it("12. removed-only POD history -> NONE", () => {
    expect(
      deriveShipmentPodState([pod("APPROVED", { removed: true }), pod("REJECTED", { removed: true })]),
    ).toBe("NONE");
  });

  it("ignores non-POD and unconfirmed documents entirely", () => {
    expect(deriveShipmentPodState([pod("APPROVED", { docType: "BOL" })])).toBe("NONE");
    expect(deriveShipmentPodState([pod("PENDING_REVIEW", { unconfirmed: true })])).toBe("NONE");
  });
});
