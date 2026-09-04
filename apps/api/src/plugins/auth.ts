import { type Permission, hasPermission } from "@loadtopia/domain";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { conflict, forbidden, unauthorized } from "../lib/errors";
import { hashSessionToken } from "../lib/session";
import { resolveSessionContext } from "../lib/session-context";

/**
 * Session authentication + authorization guards.
 *
 * `authenticate` resolves the session cookie → user → active-company context and
 * attaches an {@link AuthenticatedActor} to the request. Authorization is always
 * enforced here on the server; the web client's role checks are cosmetic only.
 */
export const authPlugin = fp(async (app: FastifyInstance) => {
  const cookieName = app.env.SESSION_COOKIE_NAME;

  app.decorate("authenticate", async (request: FastifyRequest, _reply: FastifyReply) => {
    const raw = request.cookies[cookieName];
    if (!raw) throw unauthorized();

    const ctx = await resolveSessionContext(app.prisma, hashSessionToken(raw));
    if (!ctx) throw unauthorized();

    request.currentUser = ctx.actor;
    request.currentMemberships = ctx.memberships;
    request.sessionId = ctx.sessionId;
  });

  app.decorate("requireActiveCompany", async (request: FastifyRequest, reply: FastifyReply) => {
    await app.authenticate(request, reply);
    if (!request.currentUser || request.currentUser.companyId === null) {
      throw conflict(
        "No active company. Create or join a company, then select it before using this resource.",
      );
    }
  });

  app.decorate("requirePermission", (permission: Permission) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      await app.authenticate(request, reply);
      if (!request.currentUser || !hasPermission(request.currentUser, permission)) {
        throw forbidden();
      }
    };
  });

  /**
   * preHandler factory: authenticate, then 403 unless the active role holds AT
   * LEAST ONE of the permissions. Used where two roles reach the same endpoint
   * from different sides (e.g. a carrier and a shipper both act on an offer).
   */
  app.decorate("requireAnyPermission", (...permissions: Permission[]) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      await app.authenticate(request, reply);
      const actor = request.currentUser;
      if (!actor || !permissions.some((p) => hasPermission(actor, p))) {
        throw forbidden();
      }
    };
  });

  /**
   * preHandler factory (marketplace): authenticate → require an active company →
   * require ANY of the permissions — all in a single session resolution, so the
   * documented order (auth → active company → permission → scope → validate) is
   * followed without resolving the session twice.
   */
  app.decorate("requireCompanyPermission", (...permissions: Permission[]) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      await app.requireActiveCompany(request, reply);
      const actor = request.currentUser!;
      if (!permissions.some((p) => hasPermission(actor, p))) throw forbidden();
    };
  });
});
