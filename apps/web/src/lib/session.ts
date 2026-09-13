import "server-only";
import { redirect } from "next/navigation";
import type { MeResponse } from "@loadtopia/shared";
import { ApiError, apiServer } from "./api-server";

export async function getMe(): Promise<MeResponse | null> {
  try {
    return await apiServer<MeResponse>("/api/auth/me");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

/** Use in the authenticated app layout: redirects to /login when signed out. */
export async function requireMe(): Promise<MeResponse> {
  const me = await getMe();
  if (!me) redirect("/login");
  return me;
}

export function activeMembership(me: MeResponse) {
  return me.memberships.find((m) => m.companyId === me.activeCompanyId) ?? null;
}

/** Company-primary/admin authority (Milestone 4 Phase 2/3) — mirrors the
 *  server's `isCompanyPrimaryAuthority`. This is UI-only convenience for
 *  showing/hiding management controls; the API re-enforces it regardless. */
export function isActivePrimary(me: MeResponse): boolean {
  return activeMembership(me)?.isPrimary ?? false;
}

export function can(me: MeResponse, permission: string): boolean {
  return me.permissions.includes(permission);
}
