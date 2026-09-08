import { describe, expect, it } from "vitest";
import type { LoadStatus, LoadView, MeResponse } from "@loadtopia/shared";
import {
  LOAD_EVENT_LABELS,
  canCompleteShipment,
  canRecordCheckIn,
  canReviewPod,
  canUploadDocument,
  carrierMovementAction,
  completionBlockedReason,
  formatFileSize,
  formatReportedCoordinates,
  shipmentProgress,
  shouldShowOperations,
  uploaderLabel,
  viewerRoleForLoad,
} from "./operations";

function loadView(overrides: Partial<LoadView> = {}): LoadView {
  const base: LoadView = {
    id: "load-1",
    referenceNumber: "LT-1001",
    status: "CARRIER_ASSIGNED",
    shipperCompanyId: "co-shipper",
    equipmentType: "DRY_VAN",
    mode: "FTL",
    commodity: "Pallured goods",
    weightLbs: 42000,
    // origin/destination shape is irrelevant to this module.
    origin: {} as LoadView["origin"],
    destination: {} as LoadView["destination"],
    pickupWindowStart: null,
    pickupWindowEnd: null,
    deliveryWindowStart: null,
    deliveryWindowEnd: null,
    routing: { miles: 500, driveTimeMinutes: 480, provider: "mock", isMock: true, routedAt: null },
    availableTransitions: [],
    completionReady: false,
    createdByUserId: "u-1",
    updatedByUserId: null,
    postedAt: null,
    cancelledAt: null,
    pickedUpAt: null,
    deliveredAt: null,
    completedAt: null,
    marketplace: {
      onMarket: false,
      activeOfferCount: 0,
      award: {
        carrierCompanyId: "co-carrier",
        carrierName: "Carrier Co",
        offerRoundId: "r-1",
        amount: "1850.00",
        currency: "USD",
        awardedAt: "2026-09-01T12:00:00.000Z",
        assignedAt: "2026-09-02T12:00:00.000Z",
      },
    },
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-09-02T12:00:00.000Z",
    events: [],
  };
  return { ...base, ...overrides };
}

const stepState = (p: ReturnType<typeof shipmentProgress>, key: LoadStatus) =>
  p.steps.find((s) => s.key === key)?.state;

describe("shouldShowOperations", () => {
  it("is true from AWARDED onward", () => {
    for (const status of [
      "AWARDED",
      "CARRIER_ASSIGNED",
      "PICKED_UP",
      "IN_TRANSIT",
      "DELIVERED",
      "COMPLETED",
    ] as LoadStatus[]) {
      expect(shouldShowOperations(loadView({ status }))).toBe(true);
    }
  });

  it("is false for pre-operational statuses", () => {
    for (const status of ["DRAFT", "POSTED", "OFFER_RECEIVED"] as LoadStatus[]) {
      expect(shouldShowOperations(loadView({ status, marketplace: { onMarket: true, activeOfferCount: 0, award: null } }))).toBe(false);
    }
  });

  it("shows for a load cancelled after award, not before", () => {
    expect(shouldShowOperations(loadView({ status: "CANCELLED" }))).toBe(true);
    expect(
      shouldShowOperations(
        loadView({ status: "CANCELLED", marketplace: { onMarket: false, activeOfferCount: 0, award: null } }),
      ),
    ).toBe(false);
  });
});

describe("shipmentProgress — status drives the stepper (brief items 1-5)", () => {
  it("assigned: Assigned is current, later stages upcoming", () => {
    const p = shipmentProgress(loadView({ status: "CARRIER_ASSIGNED" }));
    expect(stepState(p, "CARRIER_ASSIGNED")).toBe("current");
    expect(stepState(p, "PICKED_UP")).toBe("upcoming");
    expect(stepState(p, "COMPLETED")).toBe("upcoming");
    // Assigned timestamp comes from the award, not fabricated.
    expect(p.steps.find((s) => s.key === "CARRIER_ASSIGNED")?.at).toBe("2026-09-02T12:00:00.000Z");
  });

  it("picked up: Assigned done, Picked up current", () => {
    const p = shipmentProgress(loadView({ status: "PICKED_UP", pickedUpAt: "2026-09-03T08:00:00.000Z" }));
    expect(stepState(p, "CARRIER_ASSIGNED")).toBe("done");
    expect(stepState(p, "PICKED_UP")).toBe("current");
    expect(stepState(p, "IN_TRANSIT")).toBe("upcoming");
    expect(p.steps.find((s) => s.key === "PICKED_UP")?.at).toBe("2026-09-03T08:00:00.000Z");
  });

  it("in transit: current, and has no fabricated timestamp", () => {
    const p = shipmentProgress(loadView({ status: "IN_TRANSIT", pickedUpAt: "2026-09-03T08:00:00.000Z" }));
    expect(stepState(p, "IN_TRANSIT")).toBe("current");
    expect(p.steps.find((s) => s.key === "IN_TRANSIT")?.at).toBeNull();
  });

  it("delivered: current, earlier stages done", () => {
    const p = shipmentProgress(
      loadView({ status: "DELIVERED", pickedUpAt: "x", deliveredAt: "2026-09-05T17:00:00.000Z" }),
    );
    expect(stepState(p, "IN_TRANSIT")).toBe("done");
    expect(stepState(p, "DELIVERED")).toBe("current");
    expect(stepState(p, "COMPLETED")).toBe("upcoming");
  });

  it("completed: every stage done, none current", () => {
    const p = shipmentProgress(
      loadView({ status: "COMPLETED", deliveredAt: "d", completedAt: "2026-09-06T09:00:00.000Z" }),
    );
    expect(p.steps.every((s) => s.state === "done")).toBe(true);
    expect(p.steps.some((s) => s.state === "current")).toBe(false);
  });

  it("awarded: shows an Awarded step ahead of Assigned, not implying assignment", () => {
    const p = shipmentProgress(
      loadView({
        status: "AWARDED",
        marketplace: {
          onMarket: false,
          activeOfferCount: 0,
          award: {
            carrierCompanyId: "co-carrier",
            carrierName: "Carrier Co",
            offerRoundId: "r-1",
            amount: "1850.00",
            currency: "USD",
            awardedAt: "2026-09-01T12:00:00.000Z",
            assignedAt: null,
          },
        },
      }),
    );
    expect(p.steps[0]?.key).toBe("AWARDED");
    expect(stepState(p, "AWARDED")).toBe("current");
    expect(stepState(p, "CARRIER_ASSIGNED")).toBe("upcoming");
  });

  it("cancelled: shows a cancelled marker and no current stage", () => {
    const p = shipmentProgress(
      loadView({ status: "CANCELLED", cancelledAt: "2026-09-04T00:00:00.000Z", pickedUpAt: "2026-09-03T08:00:00.000Z" }),
    );
    expect(p.cancelled).toBe(true);
    expect(p.cancelledAt).toBe("2026-09-04T00:00:00.000Z");
    expect(p.steps.some((s) => s.state === "current")).toBe(false);
    expect(stepState(p, "PICKED_UP")).toBe("done"); // it has a real timestamp
    expect(stepState(p, "DELIVERED")).toBe("upcoming");
  });
});

describe("carrier / shipper actions come from availableTransitions", () => {
  it("CARRIER_ASSIGNED with PICKED_UP transition -> Confirm pickup", () => {
    const a = carrierMovementAction(loadView({ status: "CARRIER_ASSIGNED", availableTransitions: ["PICKED_UP"] }));
    expect(a).toMatchObject({ endpoint: "pickup", to: "PICKED_UP" });
    expect(a?.confirm).toBeNull();
  });

  it("PICKED_UP -> Start transit", () => {
    const a = carrierMovementAction(loadView({ status: "PICKED_UP", availableTransitions: ["IN_TRANSIT"] }));
    expect(a).toMatchObject({ endpoint: "in-transit", to: "IN_TRANSIT" });
  });

  it("IN_TRANSIT -> Mark delivered, with a physical-delivery confirmation", () => {
    const a = carrierMovementAction(loadView({ status: "IN_TRANSIT", availableTransitions: ["DELIVERED"] }));
    expect(a).toMatchObject({ endpoint: "deliver", to: "DELIVERED" });
    expect(a?.confirm).toMatch(/records physical delivery/i);
    expect(a?.confirm).toMatch(/POD review and shipment completion are separate/i);
  });

  it("DELIVERED shows no carrier movement action and no Complete for the carrier", () => {
    const carrierAtDelivered = loadView({ status: "DELIVERED", availableTransitions: [] });
    expect(carrierMovementAction(carrierAtDelivered)).toBeNull();
    expect(canCompleteShipment(carrierAtDelivered)).toBe(false);
  });

  it("a shipper view never yields a carrier movement action", () => {
    // The API would not put PICKED_UP in a shipper's availableTransitions; if a
    // shipper is at CARRIER_ASSIGNED their transitions are just ["CANCELLED"].
    const shipperView = loadView({ status: "CARRIER_ASSIGNED", availableTransitions: ["CANCELLED"] });
    expect(carrierMovementAction(shipperView)).toBeNull();
  });
});

describe("completion presentation (brief items 6-8, 16)", () => {
  it("Complete is absent when completionReady is false", () => {
    const l = loadView({ status: "DELIVERED", completionReady: false, availableTransitions: [] });
    expect(canCompleteShipment(l)).toBe(false);
    expect(completionBlockedReason(l)).toMatch(/approved POD is required/i);
  });

  it("Complete is shown only when the backend lists COMPLETED", () => {
    const l = loadView({
      status: "DELIVERED",
      completionReady: true,
      availableTransitions: ["COMPLETED"],
    });
    expect(canCompleteShipment(l)).toBe(true);
    expect(completionBlockedReason(l)).toBeNull();
  });

  it("does not treat status===DELIVERED alone as completable", () => {
    const l = loadView({ status: "DELIVERED", completionReady: false, availableTransitions: [] });
    // Even though it is delivered, only availableTransitions decides.
    expect(canCompleteShipment(l)).toBe(false);
  });
});

describe("formatReportedCoordinates", () => {
  it("formats a lat/long pair", () => {
    expect(formatReportedCoordinates("41.878100", "-87.629800")).toBe("41.87810, -87.62980");
  });
  it("returns null when either side is missing", () => {
    expect(formatReportedCoordinates(null, "-87.6")).toBeNull();
    expect(formatReportedCoordinates("41.8", null)).toBeNull();
  });
});

function me(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    user: { id: "u-1", email: "a@b.c", firstName: "A", lastName: "B", createdAt: "" },
    memberships: [],
    activeCompanyId: "co-carrier",
    role: "CARRIER",
    permissions: ["shipment:operate:assigned", "marketplace:browse"],
    ...overrides,
  };
}

const shipperMe = () =>
  me({ activeCompanyId: "co-shipper", role: "SHIPPER", permissions: ["load:update:own", "load:read:own"] });

describe("viewerRoleForLoad (mirrors the API's loadViewerRole)", () => {
  it("classifies shipper / carrier / admin / other", () => {
    expect(viewerRoleForLoad(shipperMe(), loadView())).toBe("shipper");
    expect(viewerRoleForLoad(me(), loadView())).toBe("carrier");
    expect(viewerRoleForLoad(me({ role: "ADMIN", activeCompanyId: null }), loadView())).toBe("admin");
    expect(viewerRoleForLoad(me({ activeCompanyId: "co-other" }), loadView())).toBe("other");
  });
});

describe("action gating helpers (backend re-enforces regardless)", () => {
  it("canRecordCheckIn: assigned carrier in window only", () => {
    expect(canRecordCheckIn(me(), loadView({ status: "IN_TRANSIT" }))).toBe(true);
    // shipper never
    expect(canRecordCheckIn(shipperMe(), loadView({ status: "IN_TRANSIT" }))).toBe(false);
    // out of window
    expect(canRecordCheckIn(me(), loadView({ status: "COMPLETED" }))).toBe(false);
    // missing permission
    expect(canRecordCheckIn(me({ permissions: [] }), loadView({ status: "IN_TRANSIT" }))).toBe(false);
  });

  it("canUploadDocument: shipper or assigned carrier, only in the activity window", () => {
    expect(canUploadDocument(shipperMe(), loadView({ status: "CARRIER_ASSIGNED" }))).toBe(true);
    expect(canUploadDocument(me(), loadView({ status: "DELIVERED" }))).toBe(true);
    expect(canUploadDocument(me(), loadView({ status: "AWARDED" }))).toBe(false);
    expect(canUploadDocument(me(), loadView({ status: "COMPLETED" }))).toBe(false);
    expect(canUploadDocument(me({ activeCompanyId: "co-other" }), loadView({ status: "DELIVERED" }))).toBe(
      false,
    );
  });

  it("canReviewPod: owning shipper only", () => {
    expect(canReviewPod(shipperMe(), loadView({ status: "DELIVERED" }))).toBe(true);
    expect(canReviewPod(me(), loadView({ status: "DELIVERED" }))).toBe(false);
  });
});

describe("uploaderLabel / formatFileSize", () => {
  it("labels the uploading party", () => {
    expect(uploaderLabel("co-shipper", "co-shipper", "co-carrier")).toBe("Shipper");
    expect(uploaderLabel("co-carrier", "co-shipper", "co-carrier")).toBe("Your company");
    expect(uploaderLabel("co-carrier", "co-shipper", "co-shipper")).toBe("Carrier");
  });
  it("formats sizes", () => {
    expect(formatFileSize(null)).toBe("—");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(3_500_000)).toBe("3.3 MB");
  });
});

describe("LOAD_EVENT_LABELS covers the M3 event types (no raw JSON in the timeline)", () => {
  for (const t of [
    "CHECK_IN_ADDED",
    "DOCUMENT_UPLOADED",
    "DOCUMENT_REVIEWED",
    "DOCUMENT_REMOVED",
    "STATUS_CHANGED",
  ]) {
    it(`has a human label for ${t}`, () => {
      expect(LOAD_EVENT_LABELS[t]).toBeTruthy();
      expect(LOAD_EVENT_LABELS[t]).not.toMatch(/[_{}]/);
    });
  }
});
