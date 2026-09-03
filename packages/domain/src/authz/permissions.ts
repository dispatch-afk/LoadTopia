import { UserRole } from "@loadtopia/shared";

/**
 * Permission catalogue. Routes and services check *permissions*, never roles
 * directly, so that new roles (BROKER, 3PL, DISPATCHER, ...) can be added later
 * by defining their permission set here with zero changes to call sites.
 *
 * Naming: `<resource>:<action>[:<scope>]`
 *   scope `own` → limited to the actor's active company (enforced by resource
 *                 policies in `policy.ts` + DB-level ownership scoping)
 *   scope `any` → unrestricted (platform staff)
 */
export const Permission = {
  // Company & membership (Milestone 1)
  COMPANY_CREATE: "company:create",
  COMPANY_READ_OWN: "company:read:own",
  COMPANY_UPDATE_OWN: "company:update:own",
  COMPANY_READ_ANY: "company:read:any",
  MEMBERSHIP_READ: "membership:read",
  MEMBERSHIP_MANAGE: "membership:manage",
  USER_INVITE: "user:invite",

  // Location book (Milestone 1)
  LOCATION_READ: "location:read",
  LOCATION_MANAGE: "location:manage",

  // Equipment (Milestone 1)
  EQUIPMENT_READ: "equipment:read",
  EQUIPMENT_MANAGE: "equipment:manage",

  // Loads (shipper-private in Milestone 1)
  LOAD_CREATE: "load:create",
  LOAD_READ_OWN: "load:read:own",
  LOAD_READ_ANY: "load:read:any",
  LOAD_UPDATE_OWN: "load:update:own",
  LOAD_DELETE_OWN: "load:delete:own",
  LOAD_POST: "load:post",
  LOAD_CANCEL_OWN: "load:cancel:own",
  LOAD_TRANSITION_ANY: "load:transition:any",

  // Marketplace (Milestone 2)
  MARKETPLACE_BROWSE: "marketplace:browse", // carrier: load board + load detail
  CARRIER_PROFILE_MANAGE: "carrier:profile:manage", // carrier: own marketplace profile
  OFFER_CREATE: "offer:create", // carrier: create offer / carrier-counter / carrier-accept
  OFFER_MANAGE_OWN: "offer:manage:own", // carrier: withdraw own thread
  OFFER_READ_OWN: "offer:read:own", // both: read offers within scope
  OFFER_RESPOND: "offer:respond", // shipper: counter / accept / reject offers on own loads
  PRICING_ESTIMATE: "pricing:estimate", // both: request a pricing estimate
  MARKETPLACE_ADMIN: "marketplace:admin", // admin: eligibility overrides, overview

  // Platform staff
  ADMIN_PANEL: "admin:panel",
  ADMIN_USER_MANAGE: "admin:user:manage",
  AUDIT_READ: "audit:read",
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const ALL_PERMISSIONS = Object.values(Permission);

/** Permissions every company member has, regardless of shipper/carrier. */
const COMMON_COMPANY_PERMISSIONS: readonly Permission[] = [
  Permission.COMPANY_CREATE,
  Permission.COMPANY_READ_OWN,
  Permission.COMPANY_UPDATE_OWN,
  Permission.MEMBERSHIP_READ,
  Permission.MEMBERSHIP_MANAGE,
  Permission.USER_INVITE,
  Permission.LOCATION_READ,
  Permission.LOCATION_MANAGE,
  Permission.EQUIPMENT_READ,
  Permission.EQUIPMENT_MANAGE,
];

const SHIPPER_PERMISSIONS: readonly Permission[] = [
  ...COMMON_COMPANY_PERMISSIONS,
  Permission.LOAD_CREATE,
  Permission.LOAD_READ_OWN,
  Permission.LOAD_UPDATE_OWN,
  Permission.LOAD_DELETE_OWN,
  Permission.LOAD_POST,
  Permission.LOAD_CANCEL_OWN,
  // Marketplace (M2): manage offers on OWN posted loads; request pricing.
  Permission.OFFER_READ_OWN,
  Permission.OFFER_RESPOND,
  Permission.PRICING_ESTIMATE,
];

const CARRIER_PERMISSIONS: readonly Permission[] = [
  ...COMMON_COMPANY_PERMISSIONS,
  // Marketplace (M2). Carriers still have NO shipper-load (LOAD_*) permissions —
  // they reach loads only through the marketplace endpoints, scoped + eligible.
  Permission.MARKETPLACE_BROWSE,
  Permission.CARRIER_PROFILE_MANAGE,
  Permission.OFFER_CREATE,
  Permission.OFFER_MANAGE_OWN,
  Permission.OFFER_READ_OWN,
  Permission.PRICING_ESTIMATE,
];

export const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly Permission[]>> = {
  [UserRole.SHIPPER]: SHIPPER_PERMISSIONS,
  [UserRole.CARRIER]: CARRIER_PERMISSIONS,
  [UserRole.ADMIN]: ALL_PERMISSIONS,
};

export function permissionsForRole(role: UserRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function roleHasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
