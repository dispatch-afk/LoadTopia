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

/** Thrown when a resource exists but is outside the actor's company scope. */
export class ResourceScopeError extends Error {
  readonly code = "NOT_FOUND";
  readonly statusCode = 404;
  constructor(message = "Resource not found") {
    super(message);
    this.name = "ResourceScopeError";
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

export function isAdmin(actor: AuthenticatedActor): boolean {
  return actor.role === UserRole.ADMIN;
}

/**
 * Company-scope guard for every company-owned resource (locations, equipment,
 * loads, members). A non-admin actor may only touch resources whose owning
 * company is their ACTIVE company. Violations raise {@link ResourceScopeError}
 * (→ 404) so a caller cannot probe for the existence of another company's data
 * by iterating UUIDs.
 */
export function isSameCompany(actor: AuthenticatedActor, resourceCompanyId: string): boolean {
  return isAdmin(actor) || (actor.companyId !== null && actor.companyId === resourceCompanyId);
}

export function assertCompanyScope(actor: AuthenticatedActor, resourceCompanyId: string): void {
  if (!isSameCompany(actor, resourceCompanyId)) {
    throw new ResourceScopeError();
  }
}

/** Minimal projection of a load needed for access decisions. */
export interface LoadAccessView {
  shipperCompanyId: string;
  carrierCompanyId: string | null;
}

/**
 * Read access: platform staff see everything; the owning shipper sees its loads.
 * (An assigned carrier will be able to read awarded loads from Milestone 2 —
 * `carrierCompanyId` is never set in Milestone 1.)
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
  if (!canReadLoad(actor, load)) throw new ResourceScopeError();
}

export function assertCanModifyLoad(actor: AuthenticatedActor, load: LoadAccessView): void {
  if (!canReadLoad(actor, load)) throw new ResourceScopeError();
  if (!canModifyLoad(actor, load)) throw new AuthorizationError();
}

/** A company's own record is readable/editable by its members (or staff). */
export function canAccessCompany(actor: AuthenticatedActor, companyId: string): boolean {
  return isSameCompany(actor, companyId);
}
