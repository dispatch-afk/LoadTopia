import type { PrismaClient } from "@loadtopia/db";
import type { ProviderRegistry } from "@loadtopia/providers";
import type { AuthenticatedActor, MembershipView } from "@loadtopia/shared";
import type { Env } from "./config/env";
import type { Permission } from "@loadtopia/domain";

declare module "fastify" {
  interface FastifyInstance {
    env: Env;
    prisma: PrismaClient;
    providers: ProviderRegistry;
    /** preHandler: 401 unless a valid session is present. Resolves the active company. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** preHandler factory: authenticate, then 403 if the active role lacks the permission. */
    requirePermission: (
      permission: Permission,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** preHandler factory: authenticate, then 403 unless the active role holds ANY of the permissions. */
    requireAnyPermission: (
      ...permissions: Permission[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** preHandler: authenticate, then 409 unless the request has an active company context. */
    requireActiveCompany: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** preHandler factory: authenticate → require active company → require ANY permission. */
    requireCompanyPermission: (
      ...permissions: Permission[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    /** Populated by `authenticate`; undefined on unauthenticated routes. */
    currentUser?: AuthenticatedActor;
    currentMemberships?: MembershipView[];
    sessionId?: string;
  }
}
