import type { AuthenticatedActor } from "@loadtopia/shared";
import { LoadStatus, UserRole } from "@loadtopia/shared";
import { Permission, roleHasPermission } from "./permissions";

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

/** Minimal projection of a load needed for shipment-operation access decisions. */
export interface ShipmentAccessView extends LoadAccessView {
  status: LoadStatus;
}

/**
 * Operational write access (Milestone 3): the assigned carrier company, and
 * ONLY the assigned carrier company, on a shipment that has actually reached
 * CARRIER_ASSIGNED or later. Deliberately separate from — and never a
 * modification of — {@link canModifyLoad}, which stays hardcoded shipper-only.
 *
 * `carrierCompanyId` is set at AWARDED (offer acceptance), one step before
 * assignment; a carrier's company briefly "wins" the load before the shipper
 * confirms assignment, and must not gain operational access during that
 * window — CARRIER_ASSIGNED is the actual start of operational execution.
 */
export function canOperateShipment(actor: AuthenticatedActor, load: ShipmentAccessView): boolean {
  if (isAdmin(actor)) return true;
  if (actor.companyId === null) return false;
  if (load.carrierCompanyId === null) return false;
  if (actor.companyId !== load.carrierCompanyId) return false;
  return load.status !== LoadStatus.AWARDED;
}

export function assertCanOperateShipment(actor: AuthenticatedActor, load: ShipmentAccessView): void {
  if (!canReadLoad(actor, load)) throw new ResourceScopeError();
  if (!canOperateShipment(actor, load)) throw new AuthorizationError();
}

/**
 * Operational-document upload access (Milestone 3, Rev. 2 §7). Unlike status
 * transitions and check-ins, Rev. 2 authorizes BOTH parties to attach BOL / POD
 * / OTHER evidence:
 *
 *   - the owning SHIPPER, with its normal load-management permission
 *     ({@link Permission.LOAD_UPDATE_OWN}); or
 *   - the ASSIGNED CARRIER company, once the shipment is actually operational
 *     (CARRIER_ASSIGNED or later — the AWARDED window is excluded, exactly as
 *     {@link canOperateShipment}), holding {@link Permission.SHIPMENT_OPERATE_ASSIGNED}.
 *
 * This is a document-specific boundary — it deliberately does NOT force the
 * shipper through the carrier-only `canOperateShipment` / `SHIPMENT_OPERATE_ASSIGNED`
 * concepts, and it does NOT grant the shipper any status-transition or check-in
 * ability. `canModifyLoad` is untouched.
 */
export function canUploadOperationalDocument(
  actor: AuthenticatedActor,
  load: ShipmentAccessView,
): boolean {
  if (isAdmin(actor)) return true;
  if (actor.companyId === null) return false;
  if (actor.companyId === load.shipperCompanyId) {
    return roleHasPermission(actor.role, Permission.LOAD_UPDATE_OWN);
  }
  if (load.carrierCompanyId !== null && actor.companyId === load.carrierCompanyId) {
    return (
      load.status !== LoadStatus.AWARDED &&
      roleHasPermission(actor.role, Permission.SHIPMENT_OPERATE_ASSIGNED)
    );
  }
  return false;
}

export function assertCanUploadOperationalDocument(
  actor: AuthenticatedActor,
  load: ShipmentAccessView,
): void {
  if (!canReadLoad(actor, load)) throw new ResourceScopeError();
  if (!canUploadOperationalDocument(actor, load)) throw new AuthorizationError();
}

/** A company's own record is readable/editable by its members (or staff). */
export function canAccessCompany(actor: AuthenticatedActor, companyId: string): boolean {
  return isSameCompany(actor, companyId);
}
