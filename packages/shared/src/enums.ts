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

export const EquipmentType = {
  DRY_VAN: "DRY_VAN",
  REEFER: "REEFER",
  FLATBED: "FLATBED",
  STEP_DECK: "STEP_DECK",
  POWER_ONLY: "POWER_ONLY",
} as const;
export type EquipmentType = (typeof EquipmentType)[keyof typeof EquipmentType];
export const EQUIPMENT_TYPES = Object.values(EquipmentType);

export const LoadEventType = {
  CREATED: "CREATED",
  STATUS_CHANGED: "STATUS_CHANGED",
  OFFER_CREATED: "OFFER_CREATED",
  OFFER_ACCEPTED: "OFFER_ACCEPTED",
  OFFER_REJECTED: "OFFER_REJECTED",
  NOTE_ADDED: "NOTE_ADDED",
  CANCELLED: "CANCELLED",
} as const;
export type LoadEventType = (typeof LoadEventType)[keyof typeof LoadEventType];

export const OfferStatus = {
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  WITHDRAWN: "WITHDRAWN",
  COUNTERED: "COUNTERED",
} as const;
export type OfferStatus = (typeof OfferStatus)[keyof typeof OfferStatus];
