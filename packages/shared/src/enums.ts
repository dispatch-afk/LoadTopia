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
  // --- Milestone 3 (Operations) ---
  CHECK_IN_ADDED: "CHECK_IN_ADDED",
  DOCUMENT_UPLOADED: "DOCUMENT_UPLOADED",
  DOCUMENT_REVIEWED: "DOCUMENT_REVIEWED",
  DOCUMENT_REMOVED: "DOCUMENT_REMOVED",
  EXCEPTION_REPORTED: "EXCEPTION_REPORTED",
  // --- Milestone 4 Phase 4 (freight audience strategy) ---
  LOAD_POSTED_TO_MARKETPLACE: "LOAD_POSTED_TO_MARKETPLACE",
  LOAD_POSTED_TO_NETWORK: "LOAD_POSTED_TO_NETWORK",
  LOAD_POSTED_TO_SELECTED_CARRIERS: "LOAD_POSTED_TO_SELECTED_CARRIERS",
  MARKETPLACE_RELEASE_SCHEDULED: "MARKETPLACE_RELEASE_SCHEDULED",
  NETWORK_RELEASE_SCHEDULED: "NETWORK_RELEASE_SCHEDULED",
  LOAD_RELEASED_TO_NETWORK: "LOAD_RELEASED_TO_NETWORK",
  LOAD_RELEASED_TO_MARKETPLACE: "LOAD_RELEASED_TO_MARKETPLACE",
  RELEASE_RESCHEDULED: "RELEASE_RESCHEDULED",
  RELEASE_CANCELLED: "RELEASE_CANCELLED",
} as const;
export type LoadEventType = (typeof LoadEventType)[keyof typeof LoadEventType];

// --- Milestone 3 (Operations) ----------------------------------------------

/** Operational document category. The Rate Confirmation is a separate,
 *  system-generated record (see RateConfirmationStatus) — never a row here. */
export const DocumentType = {
  BOL: "BOL",
  POD: "POD",
  OTHER: "OTHER",
} as const;
export type DocumentType = (typeof DocumentType)[keyof typeof DocumentType];

/** Current review pointer on a `LoadDocument` (POD only — null for BOL/OTHER). */
export const DocumentReviewStatus = {
  PENDING_REVIEW: "PENDING_REVIEW",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const;
export type DocumentReviewStatus = (typeof DocumentReviewStatus)[keyof typeof DocumentReviewStatus];

/** A single immutable review decision (`DocumentReview.decision`) — narrower
 *  than `DocumentReviewStatus`, which also has the non-decision PENDING_REVIEW. */
export const DocumentReviewDecision = {
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const;
export type DocumentReviewDecision =
  (typeof DocumentReviewDecision)[keyof typeof DocumentReviewDecision];

/** Rate Confirmation render/storage status — never gates the commercial
 *  snapshot's own validity, only whether the rendered artifact exists yet. */
export const RateConfirmationStatus = {
  PENDING: "PENDING",
  GENERATED: "GENERATED",
  FAILED: "FAILED",
} as const;
export type RateConfirmationStatus =
  (typeof RateConfirmationStatus)[keyof typeof RateConfirmationStatus];

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

// --- Relationship network (Milestone 4 Phase 2) ----------------------------

/** Mutable current state of a company-to-company Connection. There is no
 *  stored "NONE" value — the absence of a `CompanyConnection` row IS "none". */
export const ConnectionStatus = {
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  DECLINED: "DECLINED",
  DISCONNECTED: "DISCONNECTED",
} as const;
export type ConnectionStatus = (typeof ConnectionStatus)[keyof typeof ConnectionStatus];

/** Immutable connection lifecycle event log entry type. Deliberately no
 *  separate RE_REQUESTED value — a REQUESTED event following a prior
 *  DECLINED/DISCONNECTED event in the same connection's history already says
 *  "this is a re-request" without a redundant type. */
export const ConnectionEventType = {
  REQUESTED: "REQUESTED",
  ACCEPTED: "ACCEPTED",
  DECLINED: "DECLINED",
  DISCONNECTED: "DISCONNECTED",
} as const;
export type ConnectionEventType = (typeof ConnectionEventType)[keyof typeof ConnectionEventType];

/** A shipper's PRIVATE preference on a carrier. Never a rating, never public,
 *  never exposed to the carrier. */
export const CarrierPreferenceType = {
  PREFER: "PREFER",
  DO_NOT_PREFER: "DO_NOT_PREFER",
} as const;
export type CarrierPreferenceType =
  (typeof CarrierPreferenceType)[keyof typeof CarrierPreferenceType];

/** Lifecycle of one CompanyBlock episode (one row per block "episode" —
 *  unblocking does not delete the row, it moves to INACTIVE; a later re-block
 *  between the same two companies in the same direction gets a NEW row). */
export const CompanyBlockStatus = {
  PENDING_ON_COMPLETION: "PENDING_ON_COMPLETION",
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
} as const;
export type CompanyBlockStatus = (typeof CompanyBlockStatus)[keyof typeof CompanyBlockStatus];

// --- Freight audience strategy (Milestone 4 Phase 4) ------------------------

/** The shipper's chosen distribution strategy, fixed at Review & Post. */
export const LoadAudienceStrategyType = {
  MARKETPLACE: "MARKETPLACE",
  NETWORK_FIRST: "NETWORK_FIRST",
  SELECTED_FIRST: "SELECTED_FIRST",
} as const;
export type LoadAudienceStrategyType =
  (typeof LoadAudienceStrategyType)[keyof typeof LoadAudienceStrategyType];

/** The current visibility boundary for a load's audience. Ordered
 *  SELECTED < NETWORK < MARKETPLACE; only ever advances forward. */
export const LoadAudienceStage = {
  SELECTED: "SELECTED",
  NETWORK: "NETWORK",
  MARKETPLACE: "MARKETPLACE",
} as const;
export type LoadAudienceStage = (typeof LoadAudienceStage)[keyof typeof LoadAudienceStage];

/** Lifecycle of one scheduled (or manually triggered) audience-widening
 *  action. */
export const LoadReleaseStatus = {
  PENDING: "PENDING",
  RELEASED: "RELEASED",
  CANCELLED: "CANCELLED",
} as const;
export type LoadReleaseStatus = (typeof LoadReleaseStatus)[keyof typeof LoadReleaseStatus];

// --- Commercial agreement (Milestone 4 Phase 5) ------------------------------

/** The shipper's chosen commercial posture, set at create/edit time (DRAFT
 *  only). PUBLISH_RATE carries a binding `Load.postedRate`; REQUEST_OFFERS
 *  never does. Independent of the freight-audience strategy (WHO can see the
 *  load) — this is WHAT they see once they can. */
export const LoadCommercialMode = {
  PUBLISH_RATE: "PUBLISH_RATE",
  REQUEST_OFFERS: "REQUEST_OFFERS",
} as const;
export type LoadCommercialMode = (typeof LoadCommercialMode)[keyof typeof LoadCommercialMode];

/** Which action produced round 1 of an OfferThread. Default CARRIER_OFFER is
 *  truthful for every thread created before this feature shipped. */
export const OfferThreadOriginType = {
  CARRIER_OFFER: "CARRIER_OFFER",
  POSTED_RATE_BOOKING: "POSTED_RATE_BOOKING",
} as const;
export type OfferThreadOriginType =
  (typeof OfferThreadOriginType)[keyof typeof OfferThreadOriginType];
