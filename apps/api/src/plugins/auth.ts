import { type Permission, hasPermission } from "@loadtopia/domain";
import type { AuthenticatedActor, MembershipView } from "@loadtopia/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { forbidden, unauthorized } from "../lib/errors";
import { hashSessionToken, isSessionActive } from "../lib/session";

/**
 * Session authentication + permission guards.
 *
 * `authenticate` resolves the session cookie -> user -> primary membership and
 * attaches an {@link AuthenticatedActor} to the request. Authorization is always
 * enforced here on the server; the web client's role checks are cosmetic only.
 */
export const authPlugin = fp(async (app: FastifyInstance) => {
  const cookieName = app.env.SESSION_COOKIE_NAME;

  async function resolveActor(request: FastifyRequest): Promise<{
    actor: AuthenticatedActor;
    memberships: MembershipView[];
    sessionId: string;
  } | null> {
    const raw = request.cookies[cookieName];
    if (!raw) return null;

    const session = await app.prisma.session.findUnique({
      where: { tokenHash: hashSessionToken(raw) },
      include: {
        user: {
          include: {
            memberships: { include: { company: true }, orderBy: { isPrimary: "desc" } },
          },
        },
      },
    });

    if (!session || !isSessionActive(session) || !session.user.isActive) return null;

    const memberships: MembershipView[] = session.user.memberships.map((m) => ({
      companyId: m.companyId,
      companyName: m.company.name,
      companyType: m.company.type,
      role: m.role,
      isPrimary: m.isPrimary,
    }));

    const primary = memberships[0];
    const actor: AuthenticatedActor = {
      userId: session.user.id,
      email: session.user.email,
      companyId: primary?.companyId ?? null,
      companyType: primary?.companyType ?? null,
      // No membership => treat as ADMIN-provisioned staff account.
      role: primary?.role ?? "ADMIN",
    };
    return { actor, memberships, sessionId: session.id };
  }

  app.decorate("authenticate", async (request: FastifyRequest, _reply: FastifyReply) => {
    const resolved = await resolveActor(request);
    if (!resolved) throw unauthorized();
    request.currentUser = resolved.actor;
    request.currentMemberships = resolved.memberships;
    request.sessionId = resolved.sessionId;
  });

  app.decorate("requirePermission", (permission: Permission) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      await app.authenticate(request, reply);
      if (!request.currentUser || !hasPermission(request.currentUser, permission)) {
        throw forbidden();
      }
    };
  });
});
