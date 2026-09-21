import type {
  CarrierFollowView,
  CompanyMemberView,
  CompanyProfileView,
  ConnectionView,
  LoadListItem,
  LoadView,
  LocationView,
  MarketplaceLoadListItem,
  MeResponse,
  MembershipView,
  OfferThreadSummary,
  OfferThreadView,
  RateConfirmationView,
  ShipmentListItem,
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
    shipperName: "Shipper Co",
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
    shipmentNextAction: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    events: [],
    ...overrides,
  } as LoadView;
}

/** Milestone 4 Phase 10 — a Loads-workspace row, for LoadCard component tests. */
export function buildLoadListItem(overrides: Partial<LoadListItem> = {}): LoadListItem {
  return {
    id: "load-1",
    referenceNumber: "LT-0001",
    status: "DRAFT",
    equipmentType: "DRY_VAN",
    mode: "FTL",
    weightLbs: 10000,
    commodity: "General freight",
    origin: { city: "Chicago", state: "IL" },
    destination: { city: "Dallas", state: "TX" },
    pickupWindowStart: null,
    pickupWindowEnd: null,
    deliveryWindowStart: null,
    deliveryWindowEnd: null,
    miles: 925,
    audience: null,
    activeOfferCount: 0,
    commercialNextAction: "Finish Draft",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function offerThreadSummary(overrides: Partial<OfferThreadSummary> = {}): OfferThreadSummary {
  return {
    threadId: "thread-1",
    loadId: "load-1",
    status: "ACTIVE",
    roundCount: 1,
    currentAmount: "1200.00",
    currentCurrency: "USD",
    currentExpiresAt: "2026-01-02T00:00:00.000Z",
    closedReason: null,
    awaitingMyResponse: false,
    carrier: null,
    originType: "CARRIER_OFFER",
    updatedAt: "2026-01-01T00:00:00.000Z",
    load: {
      referenceNumber: "LT-0001",
      origin: { city: "Chicago", state: "IL" },
      destination: { city: "Dallas", state: "TX" },
    },
    ...overrides,
  };
}

/** Milestone 4 Phase 10 — a Find Freight board row, for MarketplaceCard
 *  component tests. */
export function buildMarketplaceLoadListItem(
  overrides: Partial<MarketplaceLoadListItem> = {},
): MarketplaceLoadListItem {
  return {
    id: "load-1",
    referenceNumber: "LT-0001",
    status: "POSTED",
    equipmentType: "DRY_VAN",
    mode: "FTL",
    commodity: "General freight",
    weightLbs: 10000,
    origin: { city: "Chicago", state: "IL" },
    destination: { city: "Dallas", state: "TX" },
    pickupWindowStart: null,
    pickupWindowEnd: null,
    deliveryWindowStart: null,
    deliveryWindowEnd: null,
    miles: 925,
    driveTimeMinutes: 780,
    routing: { provider: "mock", isMock: true },
    shipperCompanyId: "shipper-1",
    shipperName: "Acme Freight",
    shipperIsConnected: false,
    postedAt: "2026-01-01T00:00:00.000Z",
    myThread: null,
    commercialMode: "REQUEST_OFFERS",
    postedRate: null,
    ratePerMile: null,
    ...overrides,
  } as MarketplaceLoadListItem;
}

export { offerThreadSummary as buildOfferThreadSummary };

/** Milestone 4 Phase 12 — a Shipments/My-Shipments workspace row, shared by
 *  the shipper and carrier list endpoints alike. */
export function buildShipmentListItem(overrides: Partial<ShipmentListItem> = {}): ShipmentListItem {
  return {
    id: "load-1",
    referenceNumber: "LT-0001",
    status: "CARRIER_ASSIGNED",
    origin: { city: "Chicago", state: "IL" },
    destination: { city: "Dallas", state: "TX" },
    pickupWindowStart: "2026-01-05T13:00:00.000Z",
    pickupWindowEnd: "2026-01-05T17:00:00.000Z",
    deliveryWindowStart: "2026-01-07T13:00:00.000Z",
    deliveryWindowEnd: "2026-01-07T17:00:00.000Z",
    shipperCompanyId: "shipper-1",
    shipperName: "Acme Manufacturing",
    carrierCompanyId: "carrier-1",
    carrierName: "Longhorn Transportation",
    bookedRate: "1500.00",
    nextAction: "Awaiting Pickup",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
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
    closedReason: null,
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

export function buildRateConfirmationView(
  overrides: Partial<RateConfirmationView> = {},
): RateConfirmationView {
  return {
    loadId: "load-1",
    referenceNumber: "LT-0001",
    status: "GENERATED",
    awardedAt: "2026-01-01T00:00:00.000Z",
    agreedRate: "1500.00",
    currency: "USD",
    distanceMeters: 400000,
    shipper: { companyName: "Shipper Co", mcNumber: null, dotNumber: null },
    carrier: { companyName: "Carrier Co", legalName: "Carrier Co LLC", mcNumber: null, dotNumber: null },
    origin: {
      addressLine1: "1 Main St",
      addressLine2: null,
      city: "Dallas",
      state: "TX",
      postalCode: "75201",
      country: "US",
    },
    destination: {
      addressLine1: "2 Elm St",
      addressLine2: null,
      city: "Houston",
      state: "TX",
      postalCode: "77001",
      country: "US",
    },
    pickupWindowStart: null,
    pickupWindowEnd: null,
    deliveryWindowStart: null,
    deliveryWindowEnd: null,
    equipmentType: "DRY_VAN",
    commodity: null,
    weightLbs: null,
    agreementSource: "CARRIER_OFFER",
    download: { url: "https://example.test/rc.pdf", expiresAt: "2026-01-02T00:00:00.000Z" },
    documentPending: false,
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

/** Milestone 4 Phase 11 — app-shell / facility-scope fixtures. */
export function buildMembershipView(overrides: Partial<MembershipView> = {}): MembershipView {
  return {
    membershipId: "membership-1",
    companyId: "company-1",
    companyName: "Acme Manufacturing",
    companyType: "SHIPPER",
    role: "SHIPPER",
    isPrimary: true,
    isActive: true,
    ...overrides,
  };
}

export function buildMeResponse(overrides: Partial<MeResponse> = {}): MeResponse {
  const memberships = overrides.memberships ?? [buildMembershipView()];
  return {
    user: {
      id: "user-1",
      email: "shipper@it.test",
      firstName: "Sam",
      lastName: "Shipper",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    memberships,
    activeCompanyId: memberships[0]?.companyId ?? null,
    role: memberships[0]?.role ?? null,
    permissions: [],
    facilityScoped: null,
    ...overrides,
  };
}

export function buildCompanyMemberView(overrides: Partial<CompanyMemberView> = {}): CompanyMemberView {
  return {
    membershipId: "membership-1",
    userId: "user-1",
    email: "member@it.test",
    firstName: "Sam",
    lastName: "Shipper",
    role: "SHIPPER",
    isPrimary: true,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    freightAccess: { companyWide: true, facilityCount: 0 },
    ...overrides,
  };
}
