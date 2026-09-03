import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { corsOrigins } from "../config/env";

/**
 * Baseline HTTP hardening: security headers (helmet), a strict CORS allowlist,
 * cookie parsing, and a global rate limit. Per-route stricter limits (e.g. auth)
 * are layered on top in the route modules.
 */
export const securityPlugin = fp(async (app: FastifyInstance) => {
  const allowed = corsOrigins(app.env);

  await app.register(helmet, {
    // API serves JSON only; CSP is enforced by the web app, not here.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || allowed.includes(origin)) return cb(null, true);
      cb(new Error("Origin not allowed by CORS"), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });

  await app.register(cookie, {});

  await app.register(rateLimit, {
    global: true,
    max: app.env.RATE_LIMIT_MAX,
    timeWindow: app.env.RATE_LIMIT_WINDOW,
    // Prefer the authenticated user, then the client IP.
    keyGenerator: (req) => req.currentUser?.userId ?? req.ip,
  });
});
