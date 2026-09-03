import { loginSchema, registerSchema } from "@loadtopia/shared";
import { permissionsForRole } from "@loadtopia/domain";
import type { FastifyInstance, FastifyReply } from "fastify";
import { writeAudit } from "../../lib/audit";
import { unauthorized } from "../../lib/errors";
import { hashSessionToken } from "../../lib/session";
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

  // Stricter rate limit for credential endpoints.
  const authRateLimit = {
    rateLimit: {
      max: app.env.AUTH_RATE_LIMIT_MAX,
      timeWindow: app.env.AUTH_RATE_LIMIT_WINDOW,
    },
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
      permissions: result.permissions,
    };
  });

  app.post("/auth/login", { config: authRateLimit }, async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const result = await service.login(input, {
      ip: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    });
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
      role: actor.role,
      companyId: actor.companyId,
      permissions: [...permissionsForRole(actor.role)],
    };
  });
}
