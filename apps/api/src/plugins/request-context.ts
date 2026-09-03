import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

/**
 * Correlates every request with an id: honours an inbound `x-request-id`
 * (trusted from the edge/load balancer) or generates a UUID, exposes it on the
 * response, and binds it to the per-request logger.
 */
export const requestContextPlugin = fp(async (app: FastifyInstance) => {
  app.addHook("onRequest", async (request, reply) => {
    const inbound = request.headers["x-request-id"];
    const requestId = typeof inbound === "string" && inbound.length <= 128 ? inbound : randomUUID();
    (request as { id: string }).id = requestId;
    reply.header("x-request-id", requestId);
  });
});
