import { createProviderRegistry, type ProviderRegistry } from "@loadtopia/providers";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { googleCredentials, providerSelection } from "../config/env";

interface ProvidersPluginOptions {
  registry?: ProviderRegistry;
}

export const providersPlugin = fp<ProvidersPluginOptions>(async (app: FastifyInstance, opts) => {
  const registry =
    opts.registry ??
    createProviderRegistry(providerSelection(app.env), googleCredentials(app.env));
  app.decorate("providers", registry);

  const mocks = Object.entries(registry)
    .filter(([, p]) => p.isMock)
    .map(([name]) => name);
  if (mocks.length > 0) {
    app.log.warn(
      { mockProviders: mocks },
      "MOCK providers active — responses are synthetic and must not be shown as real data",
    );
  }
});
