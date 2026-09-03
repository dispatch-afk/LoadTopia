import { loginSchema, registerSchema, switchCompanySchema } from "@loadtopia/shared";
import { permissionsForRole } from "@loadtopia/domain";
import type { FastifyInstance, FastifyReply } from "fastify";
import { writeAudit } from "../../lib/audit";
import { AppError, unauthorized } from "../../lib/errors";
import { hashSessionToken } from "../../lib/session";
import { resolveSessionContext } from "../../lib/session-context";
import { AuthService } from "./auth.service";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const service = new AuthService(
    app.prisma,
    {
      memoryKiB: app.env.ARGON_MEMORY_KIB,
      timeCost: app.env.ARGON_TIME_COST,
      parallelism: app.env.ARGON_PARALLELISM,
    },
    app.env.SESSION_TTL_HOURS,
  );

  const cookieName = app.env.SESSION_COOKIE_NAME;
  const setSessionCookie = (reply: FastifyReply, token: string, expiresAt: Date) => {
    reply.setCookie(cookieName, token, {
      httpOnly: true,
      secure: app.env.SESSION_COOKIE_SECURE,
      sameSite: "lax",
      path: "/",
      domain: app.env.COOKIE_DOMAIN || undefined,
      expires: expiresAt,
    });
  };
  const clearSessionCookie = (reply: FastifyReply) => {
    reply.clearCookie(cookieName, { path: "/" });
  };

  const authRateLimit = {
    rateLimit: { max: app.env.AUTH_RATE_LIMIT_MAX, timeWindow: app.env.AUTH_RATE_LIMIT_WINDOW },
  };

  app.post("/auth/register", { config: authRateLimit }, async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const result = await service.register(input, {
      ip: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    });
    setSessionCookie(reply, result.token, result.expiresAt);
    await writeAudit(app.prisma, request, {
      actorUserId: result.user.id,
      action: "auth.register",
      entityType: "user",
      entityId: result.user.id,
    });
    reply.status(201);
    return {
      user: result.user,
      memberships: result.memberships,
      activeCompanyId: result.activeCompanyId,
      permissions: result.permissions,
    };
  });

  app.post("/auth/login", { config: authRateLimit }, async (request, reply) => {
    const input = loginSchema.parse(request.body);

    let result: Awaited<ReturnType<typeof service.login>>;
    try {
      result = await service.login(input, {
        ip: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });
    } catch (err) {
      // Append-only record of every rejected credential attempt. Identical
      // whether the email exists or not — never discloses account existence,
      // and carries NO password, hash, or token.
      if (err instanceof AppError && err.statusCode === 401) {
        await writeAudit(app.prisma, request, {
          actorUserId: null,
          action: "auth.login_failed",
          entityType: "user",
          entityId: null,
          data: { reason: "invalid_credentials", email: input.email, requestId: request.id },
        });
      }
      throw err;
    }

    setSessionCookie(reply, result.token, result.expiresAt);
    await writeAudit(app.prisma, request, {
      actorUserId: result.user.id,
      action: "auth.login",
      entityType: "user",
      entityId: result.user.id,
    });
    return {
      user: result.user,
      memberships: result.memberships,
      activeCompanyId: result.activeCompanyId,
      permissions: result.permissions,
    };
  });

  app.post("/auth/logout", async (request, reply) => {
    const raw = request.cookies[cookieName];
    if (raw) await service.logout(hashSessionToken(raw));
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/auth/me", { preHandler: [app.authenticate] }, async (request) => {
    const actor = request.currentUser;
    if (!actor) throw unauthorized();
    const user = await app.prisma.user.findUnique({ where: { id: actor.userId } });
    if (!user) throw unauthorized();
    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        createdAt: user.createdAt.toISOString(),
      },
      memberships: request.currentMemberships ?? [],
      activeCompanyId: actor.companyId,
      role: actor.companyId ? actor.role : null,
      permissions: actor.companyId || actor.role === "ADMIN" ? [...permissionsForRole(actor.role)] : [],
    };
  });

  /**
   * Switch the active company. The server verifies the target is an ACTIVE
   * membership of the caller (never trusts the id blindly) and persists it on
   * the session, so the choice survives page reloads.
   */
  app.post("/auth/switch-company", { preHandler: [app.authenticate] }, async (request) => {
    const { companyId } = switchCompanySchema.parse(request.body);
    const raw = request.cookies[cookieName]!;
    const ctx = await resolveSessionContext(app.prisma, hashSessionToken(raw), companyId);
    if (!ctx) throw unauthorized();

    await writeAudit(app.prisma, request, {
      actorUserId: ctx.actor.userId,
      action: "auth.switch_company",
      entityType: "company",
      entityId: companyId,
    });

    return {
      activeCompanyId: ctx.actor.companyId,
      role: ctx.actor.role,
      permissions: [...permissionsForRole(ctx.actor.role)],
      memberships: ctx.memberships,
    };
  });
}
