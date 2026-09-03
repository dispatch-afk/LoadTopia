import { UserRole } from "@loadtopia/shared";

/**
 * Permission catalogue. Routes and services check *permissions*, never roles
 * directly, so that new roles (BROKER, 3PL, DISPATCHER, ...) can be added later
 * by defining their permission set here with zero changes to call sites.
 *
 * Naming: `<resource>:<action>[:<scope>]`
 *   scope `own` → limited to the actor's own company (enforced by resource
 *                 policies in `policy.ts`)
 *   scope `any` → unrestricted (platform staff)
 */
export const Permission = {
  LOAD_CREATE: "load:create",
  LOAD_READ_OWN: "load:read:own",
  LOAD_READ_ANY: "load:read:any",
  LOAD_UPDATE_OWN: "load:update:own",
  LOAD_POST: "load:post",
  LOAD_CANCEL_OWN: "load:cancel:own",
  LOAD_TRANSITION_ANY: "load:transition:any",

  MARKETPLACE_BROWSE: "marketplace:browse",

  OFFER_CREATE: "offer:create",
  OFFER_READ_OWN: "offer:read:own",
  OFFER_ACCEPT_OWN: "offer:accept:own",

  COMPANY_READ_OWN: "company:read:own",
  COMPANY_UPDATE_OWN: "company:update:own",
  COMPANY_READ_ANY: "company:read:any",

  USER_INVITE: "user:invite",

  ADMIN_PANEL: "admin:panel",
  ADMIN_USER_MANAGE: "admin:user:manage",
  AUDIT_READ: "audit:read",
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const ALL_PERMISSIONS = Object.values(Permission);

const SHIPPER_PERMISSIONS: readonly Permission[] = [
  Permission.LOAD_CREATE,
  Permission.LOAD_READ_OWN,
  Permission.LOAD_UPDATE_OWN,
  Permission.LOAD_POST,
  Permission.LOAD_CANCEL_OWN,
  Permission.OFFER_READ_OWN,
  Permission.OFFER_ACCEPT_OWN,
  Permission.COMPANY_READ_OWN,
  Permission.COMPANY_UPDATE_OWN,
  Permission.USER_INVITE,
];

const CARRIER_PERMISSIONS: readonly Permission[] = [
  Permission.MARKETPLACE_BROWSE,
  Permission.LOAD_READ_OWN,
  Permission.OFFER_CREATE,
  Permission.OFFER_READ_OWN,
  Permission.COMPANY_READ_OWN,
  Permission.COMPANY_UPDATE_OWN,
  Permission.USER_INVITE,
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
