/**
 * Canonical domain enumerations shared between the API, the web client, and the
 * database layer. These string values are the single source of truth and are
 * mirrored 1:1 by Prisma enums in `packages/db/prisma/schema.prisma`.
 */

export const UserRole = {
  SHIPPER: "SHIPPER",
  CARRIER: "CARRIER",
  ADMIN: "ADMIN",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];
export const USER_ROLES = Object.values(UserRole);

export const CompanyType = {
  SHIPPER: "SHIPPER",
  CARRIER: "CARRIER",
} as const;
export type CompanyType = (typeof CompanyType)[keyof typeof CompanyType];
export const COMPANY_TYPES = Object.values(CompanyType);

export const LoadStatus = {
  DRAFT: "DRAFT",
  POSTED: "POSTED",
  OFFER_RECEIVED: "OFFER_RECEIVED",
  AWARDED: "AWARDED",
  CARRIER_ASSIGNED: "CARRIER_ASSIGNED",
  PICKED_UP: "PICKED_UP",
  IN_TRANSIT: "IN_TRANSIT",
  DELIVERED: "DELIVERED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;
export type LoadStatus = (typeof LoadStatus)[keyof typeof LoadStatus];
export const LOAD_STATUSES = Object.values(LoadStatus);

export const TransportMode = {
  FTL: "FTL",
  LTL: "LTL",
  PARTIAL: "PARTIAL",
} as const;
export type TransportMode = (typeof TransportMode)[keyof typeof TransportMode];
export const TRANSPORT_MODES = Object.values(TransportMode);

export const EquipmentType = {
  DRY_VAN: "DRY_VAN",
  REEFER: "REEFER",
  FLATBED: "FLATBED",
  STEP_DECK: "STEP_DECK",
  CONESTOGA: "CONESTOGA",
  BOX_TRUCK: "BOX_TRUCK",
  POWER_ONLY: "POWER_ONLY",
  HOTSHOT: "HOTSHOT",
  OTHER: "OTHER",
} as const;
export type EquipmentType = (typeof EquipmentType)[keyof typeof EquipmentType];
export const EQUIPMENT_TYPES = Object.values(EquipmentType);

export const LoadEventType = {
  CREATED: "CREATED",
  UPDATED: "UPDATED",
  STATUS_CHANGED: "STATUS_CHANGED",
  OFFER_CREATED: "OFFER_CREATED",
  OFFER_ACCEPTED: "OFFER_ACCEPTED",
  OFFER_REJECTED: "OFFER_REJECTED",
  NOTE_ADDED: "NOTE_ADDED",
  CANCELLED: "CANCELLED",
} as const;
export type LoadEventType = (typeof LoadEventType)[keyof typeof LoadEventType];

// --- Marketplace (Milestone 2) --------------------------------------------

export const CarrierOperatingStatus = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
} as const;
export type CarrierOperatingStatus =
  (typeof CarrierOperatingStatus)[keyof typeof CarrierOperatingStatus];

export const MarketplaceEligibility = {
  PENDING: "PENDING",
  ELIGIBLE: "ELIGIBLE",
  INELIGIBLE: "INELIGIBLE",
  SUSPENDED: "SUSPENDED",
} as const;
export type MarketplaceEligibility =
  (typeof MarketplaceEligibility)[keyof typeof MarketplaceEligibility];

export const CarrierVerificationStatus = {
  UNVERIFIED: "UNVERIFIED",
  VERIFYING: "VERIFYING",
  VERIFIED: "VERIFIED",
  FAILED: "FAILED",
} as const;
export type CarrierVerificationStatus =
  (typeof CarrierVerificationStatus)[keyof typeof CarrierVerificationStatus];

/** Mutable status of a negotiation thread (the OfferRound rows are immutable). */
export const OfferThreadStatus = {
  ACTIVE: "ACTIVE",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  WITHDRAWN: "WITHDRAWN",
  EXPIRED: "EXPIRED",
} as const;
export type OfferThreadStatus = (typeof OfferThreadStatus)[keyof typeof OfferThreadStatus];
export const OFFER_THREAD_STATUSES = Object.values(OfferThreadStatus);

export const OfferEventType = {
  CREATED: "CREATED",
  COUNTERED: "COUNTERED",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  WITHDRAWN: "WITHDRAWN",
  EXPIRED: "EXPIRED",
} as const;
export type OfferEventType = (typeof OfferEventType)[keyof typeof OfferEventType];
