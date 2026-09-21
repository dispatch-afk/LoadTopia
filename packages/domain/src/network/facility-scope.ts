export interface FacilityScopeRow {
  locationId: string;
}

/**
 * ROLE/PERMISSION decides WHAT a user may do; facility scope decides WHERE.
 * No scope rows for a membership = company-wide access (the common case for
 * a single-location or small company — nothing extra to configure). One or
 * more rows = restricted to those locations only.
 */
export function isCompanyWideScope(scopeRows: readonly FacilityScopeRow[]): boolean {
  return scopeRows.length === 0;
}

export function isLocationInScope(
  scopeRows: readonly FacilityScopeRow[],
  locationId: string,
): boolean {
  if (isCompanyWideScope(scopeRows)) return true;
  return scopeRows.some((r) => r.locationId === locationId);
}

/**
 * Whether a facility-scoped membership may act on a load, given its origin
 * and destination locations: company-wide scope always can; a restricted
 * membership needs EITHER endpoint to be in scope (a load moving freight
 * FROM or TO one of the user's facilities is within their remit either way).
 * Not wired into any endpoint in Phase 2 — this is the shared decision
 * function later enforcement phases call, so the rule is centralized once.
 */
export function isLoadInFacilityScope(
  scopeRows: readonly FacilityScopeRow[],
  loadLocationIds: { originLocationId: string; destinationLocationId: string },
): boolean {
  if (isCompanyWideScope(scopeRows)) return true;
  return (
    isLocationInScope(scopeRows, loadLocationIds.originLocationId) ||
    isLocationInScope(scopeRows, loadLocationIds.destinationLocationId)
  );
}
