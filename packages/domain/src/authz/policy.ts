import type { AuthenticatedActor } from "@loadtopia/shared";
import { UserRole } from "@loadtopia/shared";
import { type Permission, roleHasPermission } from "./permissions";

export class AuthorizationError extends Error {
  readonly code = "FORBIDDEN";
  readonly statusCode = 403;
  constructor(message = "You do not have permission to perform this action") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function hasPermission(actor: AuthenticatedActor, permission: Permission): boolean {
  return roleHasPermission(actor.role, permission);
}

export function assertPermission(actor: AuthenticatedActor, permission: Permission): void {
  if (!hasPermission(actor, permission)) {
    throw new AuthorizationError();
  }
}

/** Minimal projection of a load needed for access decisions. */
export interface LoadAccessView {
  shipperCompanyId: string;
  carrierCompanyId: string | null;
}

function isAdmin(actor: AuthenticatedActor): boolean {
  return actor.role === UserRole.ADMIN;
}

/**
 * Read access: platform staff see everything; the owning shipper sees its loads;
 * an assigned carrier sees loads it has been awarded/assigned.
 */
export function canReadLoad(actor: AuthenticatedActor, load: LoadAccessView): boolean {
  if (isAdmin(actor)) return true;
  if (actor.companyId === null) return false;
  if (actor.companyId === load.shipperCompanyId) return true;
  if (load.carrierCompanyId !== null && actor.companyId === load.carrierCompanyId) return true;
  return false;
}

/** Mutating a load's core details is limited to the owning shipper (or staff). */
export function canModifyLoad(actor: AuthenticatedActor, load: LoadAccessView): boolean {
  if (isAdmin(actor)) return true;
  return actor.role === UserRole.SHIPPER && actor.companyId === load.shipperCompanyId;
}

export function assertCanReadLoad(actor: AuthenticatedActor, load: LoadAccessView): void {
  if (!canReadLoad(actor, load)) throw new AuthorizationError();
}

export function assertCanModifyLoad(actor: AuthenticatedActor, load: LoadAccessView): void {
  if (!canModifyLoad(actor, load)) throw new AuthorizationError();
}

/** A company's own record is readable/editable by its members (or staff). */
export function canAccessCompany(actor: AuthenticatedActor, companyId: string): boolean {
  return isAdmin(actor) || actor.companyId === companyId;
}
