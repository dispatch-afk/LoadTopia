import type {
  CarrierFollowView,
  CompanyProfileView,
  ConnectionView,
  LoadView,
  LocationView,
  OfferThreadView,
} from "@loadtopia/shared";

function location(overrides: Partial<LocationView> = {}): LocationView {
  return {
    id: "loc-1",
    companyId: "company-1",
    name: null,
    addressLine1: "1 Main St",
    addressLine2: null,
    city: "Dallas",
    state: "TX",
    postalCode: "75201",
    country: "US",
    latitude: null,
    longitude: null,
    isGeocoded: true,
    geocodedBy: "mock",
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A minimal but type-complete `LoadView`, for component tests that only
 *  exercise a few fields — override just what the test cares about. */
export function buildLoadView(overrides: Partial<LoadView> = {}): LoadView {
  return {
    id: "load-1",
    referenceNumber: "LT-0001",
    status: "DRAFT",
    shipperCompanyId: "company-1",
    equipmentType: "DRY_VAN",
    mode: "FTL",
    commodity: null,
    weightLbs: null,
    origin: location({ city: "Dallas", state: "TX" }),
    destination: location({ id: "loc-2", city: "Houston", state: "TX" }),
    pickupWindowStart: null,
    pickupWindowEnd: null,
    deliveryWindowStart: null,
    deliveryWindowEnd: null,
    routing: { provider: null, isMock: true, miles: 240, driveTimeMinutes: 210, routedAt: null },
    availableTransitions: [],
    completionReady: false,
    createdByUserId: "user-1",
    updatedByUserId: null,
    postedAt: null,
    cancelledAt: null,
    pickedUpAt: null,
    deliveredAt: null,
    completedAt: null,
    marketplace: { onMarket: false, activeOfferCount: 0, award: null },
    audience: null,
    commercialMode: "REQUEST_OFFERS",
    postedRate: null,
    ratePerMile: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    events: [],
    ...overrides,
  } as LoadView;
}

export function buildOfferThreadView(overrides: Partial<OfferThreadView> = {}): OfferThreadView {
  return {
    threadId: "thread-1",
    loadId: "load-1",
    status: "ACTIVE",
    roundCount: 1,
    currentAmount: "1500.00",
    currentCurrency: "USD",
    currentExpiresAt: "2026-01-02T00:00:00.000Z",
    awaitingMyResponse: true,
    carrier: { companyId: "carrier-1", name: "Acme Trucking" },
    originType: "CARRIER_OFFER",
    updatedAt: "2026-01-01T00:00:00.000Z",
    load: {
      id: "load-1",
      referenceNumber: "LT-0001",
      status: "OFFER_RECEIVED",
      origin: { city: "Dallas", state: "TX" },
      destination: { city: "Houston", state: "TX" },
      equipmentType: "DRY_VAN",
    },
    rounds: [
      {
        id: "round-1",
        roundNumber: 1,
        proposedByCompanyId: "carrier-1",
        proposedByParty: "CARRIER",
        proposedByName: "Acme Trucking",
        amount: "1500.00",
        currency: "USD",
        message: null,
        expiresAt: "2026-01-02T00:00:00.000Z",
        isExpired: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    events: [],
    actions: { canCounter: true, canAccept: true, canReject: true, canWithdraw: false },
    ...overrides,
  };
}

export function buildConnectionView(overrides: Partial<ConnectionView> = {}): ConnectionView {
  return {
    id: "conn-1",
    companyAId: "company-1",
    companyBId: "company-2",
    counterpartCompanyId: "company-2",
    counterpartCompanyName: "Longhorn Transportation",
    status: "PENDING",
    requesterCompanyId: "company-2",
    awaitingMyResponse: true,
    requestedAt: "2026-01-01T00:00:00.000Z",
    respondedAt: null,
    disconnectedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    sharedHistory: {
      shipmentsTogether: 0,
      completedShipments: 0,
      activeShipments: 0,
      lastWorkedTogether: null,
    },
    ...overrides,
  };
}

export function buildCarrierFollowView(overrides: Partial<CarrierFollowView> = {}): CarrierFollowView {
  return {
    id: "follow-1",
    shipperCompanyId: "company-1",
    shipperCompanyName: "Acme Manufacturing",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function buildCompanyProfileView(overrides: Partial<CompanyProfileView> = {}): CompanyProfileView {
  return {
    id: "company-2",
    type: "CARRIER",
    name: "Longhorn Transportation",
    city: "Austin",
    state: "TX",
    memberSince: "2026-01-01T00:00:00.000Z",
    capabilities: {
      legalName: "Longhorn Transportation LLC",
      equipmentTypes: ["DRY_VAN"],
      serviceAreaStates: ["TX"],
    },
    relationship: {
      connection: null,
      connectionEvents: [],
      isFollowing: null,
      preference: null,
      blockStatus: null,
      groups: null,
    },
    sharedHistory: {
      shipmentsTogether: 0,
      completedShipments: 0,
      activeShipments: 0,
      lastWorkedTogether: null,
      recentLanes: [],
    },
    ...overrides,
  };
}
