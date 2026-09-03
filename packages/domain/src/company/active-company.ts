/**
 * Active-company resolution for a multi-company user.
 *
 * The server never trusts a client-supplied company id: it must correspond to an
 * ACTIVE membership of the authenticated user. This module is the pure decision
 * logic; the API layer supplies the memberships from the database and persists
 * the resolved choice on the session.
 */

export class CompanyContextError extends Error {
  readonly code = "COMPANY_CONTEXT";
  readonly statusCode: number;
  constructor(message: string, statusCode = 403) {
    super(message);
    this.name = "CompanyContextError";
    this.statusCode = statusCode;
  }
}

export interface MembershipRef {
  companyId: string;
  isActive: boolean;
  isPrimary: boolean;
  createdAt: Date | string;
}

function activeMemberships(memberships: MembershipRef[]): MembershipRef[] {
  return memberships
    .filter((m) => m.isActive)
    .sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      const at = a.createdAt instanceof Date ? a.createdAt.getTime() : Date.parse(String(a.createdAt));
      const bt = b.createdAt instanceof Date ? b.createdAt.getTime() : Date.parse(String(b.createdAt));
      return at - bt;
    });
}

/** The company a session should default to when none is explicitly selected. */
export function defaultActiveCompanyId(memberships: MembershipRef[]): string | null {
  return activeMemberships(memberships)[0]?.companyId ?? null;
}

/**
 * Resolve the company context for a request.
 *
 * @param memberships  the user's memberships (from the DB)
 * @param sessionCompanyId  the company id currently stored on the session
 * @param requestedCompanyId  an explicit switch request, if any
 * @returns the company id to act as, or null (staff account with no membership)
 * @throws CompanyContextError if an explicit request names a company the user is
 *         not an active member of
 */
export function resolveActiveCompany(
  memberships: MembershipRef[],
  sessionCompanyId: string | null,
  requestedCompanyId?: string,
): string | null {
  const active = activeMemberships(memberships);
  const activeIds = new Set(active.map((m) => m.companyId));

  if (requestedCompanyId !== undefined) {
    if (!activeIds.has(requestedCompanyId)) {
      throw new CompanyContextError(
        "You are not an active member of that company",
        activeIds.size === 0 ? 403 : 404,
      );
    }
    return requestedCompanyId;
  }

  if (sessionCompanyId !== null && activeIds.has(sessionCompanyId)) {
    return sessionCompanyId;
  }
  return active[0]?.companyId ?? null;
}
