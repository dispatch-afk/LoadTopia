import { createPrismaClient, type PrismaClient } from "@loadtopia/db";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

interface PrismaPluginOptions {
  /** Inject a client (tests). When omitted a real client is created + owned. */
  client?: PrismaClient;
}

export const prismaPlugin = fp<PrismaPluginOptions>(async (app: FastifyInstance, opts) => {
  const client = opts.client ?? createPrismaClient();
  const owned = !opts.client;

  app.decorate("prisma", client);

  app.addHook("onClose", async () => {
    if (owned) await client.$disconnect();
  });
});
