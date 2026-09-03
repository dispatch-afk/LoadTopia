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
    /** preHandler: rejects with 401 unless a valid session is present. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** preHandler factory: 401 if unauthenticated, 403 if missing the permission. */
    requirePermission: (
      permission: Permission,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    /** Populated by `authenticate`; undefined on unauthenticated routes. */
    currentUser?: AuthenticatedActor;
    currentMemberships?: MembershipView[];
    sessionId?: string;
  }
}
