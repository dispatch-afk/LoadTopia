import type { PrismaClient } from "@loadtopia/db";
import { resolveActiveCompany } from "@loadtopia/domain";
import type { AuthenticatedActor, MembershipView } from "@loadtopia/shared";
import { isSessionActive } from "./session";

export interface SessionContext {
  sessionId: string;
  actor: AuthenticatedActor;
  memberships: MembershipView[];
}

interface LoadedMembership {
  id: string;
  companyId: string;
  role: MembershipView["role"];
  isPrimary: boolean;
  isActive: boolean;
  createdAt: Date;
  company: { id: string; name: string; type: MembershipView["companyType"] };
}

function toMembershipViews(memberships: LoadedMembership[]): MembershipView[] {
  return memberships.map((m) => ({
    membershipId: m.id,
    companyId: m.companyId,
    companyName: m.company.name,
    companyType: m.company.type,
    role: m.role,
    isPrimary: m.isPrimary,
    isActive: m.isActive,
  }));
}

/**
 * Resolve the full request context from a session token hash:
 *  session -> user -> memberships -> ACTIVE company (verified against an active
 *  membership; never a client claim). If the resolved active company differs
 *  from what the session stored (first login, or the user left that company),
 *  the session is updated so the choice is sticky.
 *
 * @param requestedCompanyId  only supplied by the explicit company-switch route
 * @returns null when there is no valid session
 */
export async function resolveSessionContext(
  prisma: PrismaClient,
  tokenHash: string,
  requestedCompanyId?: string,
): Promise<SessionContext | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: {
      user: {
        include: {
          memberships: {
            include: { company: { select: { id: true, name: true, type: true } } },
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          },
        },
      },
    },
  });

  if (!session || !isSessionActive(session) || !session.user.isActive) return null;

  const memberships = session.user.memberships as LoadedMembership[];
  const views = toMembershipViews(memberships);

  const activeCompanyId = resolveActiveCompany(
    memberships.map((m) => ({
      companyId: m.companyId,
      isActive: m.isActive,
      isPrimary: m.isPrimary,
      createdAt: m.createdAt,
    })),
    session.activeCompanyId,
    requestedCompanyId,
  );

  if (activeCompanyId !== session.activeCompanyId) {
    await prisma.session.update({
      where: { id: session.id },
      data: { activeCompanyId },
    });
  }

  const activeMembership = memberships.find(
    (m) => m.companyId === activeCompanyId && m.isActive,
  );

  const actor: AuthenticatedActor = {
    userId: session.user.id,
    email: session.user.email,
    companyId: activeMembership?.companyId ?? null,
    companyType: activeMembership?.company.type ?? null,
    // A user with no membership is a platform-staff (ADMIN) account.
    role: activeMembership?.role ?? "ADMIN",
    membershipId: activeMembership?.id ?? null,
  };

  return { sessionId: session.id, actor, memberships: views };
}
