import type {
  CarrierOperatingStatus,
  CarrierVerificationStatus,
  CompanyType,
  EquipmentType,
  LoadEventType,
  LoadStatus,
  MarketplaceEligibility,
  OfferEventType,
  OfferThreadStatus,
  TransportMode,
  UserRole,
} from "./enums";

/**
 * A user's identity + the company context a request is acting on behalf of.
 * `companyId`/`companyType`/`role` always reflect the ACTIVE company (resolved
 * server-side from the session + an active membership), never a client claim.
 */
export interface AuthenticatedActor {
  userId: string;
  email: string;
  /** Active company. Null only for ADMIN staff accounts with no membership. */
  companyId: string | null;
  companyType: CompanyType | null;
  role: UserRole;
  /** Membership id for the active company, if any. */
  membershipId: string | null;
}

export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: string;
}

export interface MembershipView {
  membershipId: string;
  companyId: string;
  companyName: string;
  companyType: CompanyType;
  role: UserRole;
  isPrimary: boolean;
  isActive: boolean;
}

export interface MeResponse {
  user: PublicUser;
  memberships: MembershipView[];
  activeCompanyId: string | null;
  role: UserRole | null;
  permissions: string[];
}

export interface CompanyView {
  id: string;
  type: CompanyType;
  name: string;
  mcNumber: string | null;
  dotNumber: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  loadNumberPrefix: string;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyMemberView {
  membershipId: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  isPrimary: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface LocationView {
  id: string;
  companyId: string;
  name: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  latitude: string | null;
  longitude: string | null;
  isGeocoded: boolean;
  geocodedBy: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EquipmentView {
  id: string;
  companyId: string;
  type: EquipmentType;
  name: string | null;
  trailerLengthFt: number | null;
  capacityLbs: number | null;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LoadRouting {
  miles: number | null;
  driveTimeMinutes: number | null;
  provider: string | null;
  isMock: boolean;
  routedAt: string | null;
}

export interface LoadEventView {
  id: string;
  type: LoadEventType;
  fromStatus: LoadStatus | null;
  toStatus: LoadStatus | null;
  actorUserId: string | null;
  actorName: string | null;
  note: string | null;
  createdAt: string;
}

export interface LoadListItem {
  id: string;
  referenceNumber: string;
  status: LoadStatus;
  equipmentType: EquipmentType;
  mode: TransportMode;
  weightLbs: number | null;
  commodity: string | null;
  origin: { city: string; state: string };
  destination: { city: string; state: string };
  pickupWindowStart: string | null;
  pickupWindowEnd: string | null;
  deliveryWindowStart: string | null;
  deliveryWindowEnd: string | null;
  miles: number | null;
  createdAt: string;
}

export interface LoadView {
  id: string;
  referenceNumber: string;
  status: LoadStatus;
  shipperCompanyId: string;
  equipmentType: EquipmentType;
  mode: TransportMode;
  commodity: string | null;
  weightLbs: number | null;
  origin: LocationView;
  destination: LocationView;
  pickupWindowStart: string | null;
  pickupWindowEnd: string | null;
  deliveryWindowStart: string | null;
  deliveryWindowEnd: string | null;
  routing: LoadRouting;
  availableTransitions: LoadStatus[];
  createdByUserId: string;
  updatedByUserId: string | null;
  postedAt: string | null;
  cancelledAt: string | null;
  /** Marketplace (Milestone 2): active-offer count + award outcome. */
  marketplace: LoadMarketplaceView;
  createdAt: string;
  updatedAt: string;
  events: LoadEventView[];
}

export interface LoadMarketplaceView {
  onMarket: boolean;
  activeOfferCount: number;
  award: {
    carrierCompanyId: string;
    carrierName: string;
    offerRoundId: string;
    amount: string;
    currency: string;
    awardedAt: string;
    assignedAt: string | null;
  } | null;
}

// --- Marketplace: carrier profile ---------------------------------------- --

export interface CarrierProfileView {
  id: string;
  companyId: string;
  legalName: string;
  mcNumber: string | null;
  dotNumber: string | null;
  operatingStatus: CarrierOperatingStatus;
  marketplaceEligibility: MarketplaceEligibility;
  eligibilityReason: string | null;
  verification: {
    status: CarrierVerificationStatus;
    provider: string | null;
    isMock: boolean | null;
    note: string | null;
    verifiedAt: string | null;
  };
  equipmentTypes: EquipmentType[];
  serviceAreaStates: string[];
  createdAt: string;
  updatedAt: string;
}

export interface EligibilityView {
  eligible: boolean;
  reasons: string[];
}

// --- Marketplace: load board -------------------------------------------- ---

export interface MarketplaceLoadListItem {
  id: string;
  referenceNumber: string;
  status: LoadStatus;
  equipmentType: EquipmentType;
  mode: TransportMode;
  commodity: string | null;
  weightLbs: number | null;
  origin: { city: string; state: string };
  destination: { city: string; state: string };
  pickupWindowStart: string | null;
  pickupWindowEnd: string | null;
  deliveryWindowStart: string | null;
  deliveryWindowEnd: string | null;
  miles: number | null;
  driveTimeMinutes: number | null;
  shipperName: string;
  postedAt: string | null;
  /** This carrier's negotiation on this load, if any. */
  myThread: OfferThreadSummary | null;
}

export interface MarketplaceLoadView extends MarketplaceLoadListItem {
  eligibility: EligibilityView;
}

// --- Marketplace: offers / negotiation --------------------------------- ----

export interface OfferRoundView {
  id: string;
  roundNumber: number;
  proposedByCompanyId: string;
  proposedByParty: "CARRIER" | "SHIPPER";
  proposedByName: string;
  amount: string;
  currency: string;
  message: string | null;
  expiresAt: string;
  isExpired: boolean;
  createdAt: string;
}

export interface OfferEventView {
  id: string;
  type: OfferEventType;
  actorUserId: string | null;
  actorName: string | null;
  actorParty: "CARRIER" | "SHIPPER" | "SYSTEM";
  createdAt: string;
}

export interface OfferThreadSummary {
  threadId: string;
  loadId: string;
  status: OfferThreadStatus;
  roundCount: number;
  currentAmount: string | null;
  currentCurrency: string;
  currentExpiresAt: string | null;
  /** True when it is this viewer's turn to respond to the current round. */
  awaitingMyResponse: boolean;
  carrier: { companyId: string; name: string } | null;
  updatedAt: string;
}

export interface OfferThreadView extends OfferThreadSummary {
  load: {
    id: string;
    referenceNumber: string;
    status: LoadStatus;
    origin: { city: string; state: string };
    destination: { city: string; state: string };
    equipmentType: EquipmentType;
  };
  rounds: OfferRoundView[];
  events: OfferEventView[];
  /** Actions the current viewer may take on the current round / thread. */
  actions: {
    canCounter: boolean;
    canAccept: boolean;
    canReject: boolean;
    canWithdraw: boolean;
  };
}

// --- Marketplace: pricing --------------------------------------------- -----

export interface PricingEstimateView {
  currency: string;
  lowRate: string;
  midRate: string;
  highRate: string;
  ratePerMile: string | null;
  confidence: "low" | "medium" | "high";
  provider: string;
  isMock: boolean;
  disclaimer: string | null;
  distanceMeters: number | null;
  retrievedAt: string;
  snapshotId: string | null;
}

export interface PricingSnapshotView {
  id: string;
  loadId: string;
  provider: string;
  isMock: boolean;
  currency: string;
  lowRate: string;
  midRate: string;
  highRate: string;
  ratePerMile: string | null;
  confidence: string;
  disclaimer: string | null;
  distanceMeters: number | null;
  createdAt: string;
}

// --- Marketplace: admin ------------------------------------------------ ----

export interface AdminCarrierProfileRow {
  companyId: string;
  companyName: string;
  legalName: string;
  mcNumber: string | null;
  dotNumber: string | null;
  operatingStatus: CarrierOperatingStatus;
  marketplaceEligibility: MarketplaceEligibility;
  verificationStatus: CarrierVerificationStatus;
  verificationIsMock: boolean | null;
  activeOffers: number;
  updatedAt: string;
}

export interface AdminMarketplaceOverview {
  loads: { posted: number; offerReceived: number; awarded: number; carrierAssigned: number };
  offers: { activeThreads: number; acceptedThreads: number };
  carrierProfiles: Record<MarketplaceEligibility, number>;
  providers: Record<string, { status: string; isMock: boolean; message?: string }>;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

export type HealthStatus = "ok" | "degraded" | "error";

export interface HealthReport {
  status: HealthStatus;
  service: string;
  version: string;
  timestamp: string;
  uptimeSeconds: number;
  checks: {
    database: { status: HealthStatus; latencyMs: number | null; message?: string };
    providers: Record<string, { status: HealthStatus; isMock: boolean; message?: string }>;
  };
}
