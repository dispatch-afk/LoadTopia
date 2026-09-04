import type { ProviderName, ProviderRegistry } from "./types";
import { MockCarrierVerificationProvider } from "./mock/mock-carrier-verification-provider";
import { MockPricingProvider } from "./mock/mock-pricing-provider";
import { MockRoutingProvider } from "./mock/mock-routing-provider";
import {
  MockGeocodingProvider,
  MockNotificationProvider,
  MockPaymentProvider,
  MockStorageProvider,
  MockTrackingProvider,
} from "./mock/mock-misc-providers";

/** Per-provider selection, e.g. `{ pricing: "mock", routing: "mock" }`. */
export type ProviderSelection = Record<ProviderName, string>;

/**
 * Builds the concrete provider set from configuration.
 *
 * Phase 0 ships only `mock` adapters. Selecting any other value fails loudly so
 * a misconfigured environment can never silently fall back to synthetic data in
 * production. Real adapters get registered here as they are implemented.
 */
export function createProviderRegistry(selection: ProviderSelection): ProviderRegistry {
  return {
    routing: build("routing", selection.routing, { mock: () => new MockRoutingProvider() }),
    pricing: build("pricing", selection.pricing, { mock: () => new MockPricingProvider() }),
    geocoding: build("geocoding", selection.geocoding, { mock: () => new MockGeocodingProvider() }),
    carrierVerification: build("carrierVerification", selection.carrierVerification, {
      mock: () => new MockCarrierVerificationProvider(),
    }),
    payment: build("payment", selection.payment, { mock: () => new MockPaymentProvider() }),
    storage: build("storage", selection.storage, { mock: () => new MockStorageProvider() }),
    notification: build("notification", selection.notification, {
      mock: () => new MockNotificationProvider(),
    }),
    tracking: build("tracking", selection.tracking, { mock: () => new MockTrackingProvider() }),
  };
}

function build<T>(kind: ProviderName, choice: string, adapters: Record<string, () => T>): T {
  const factory = adapters[choice];
  if (!factory) {
    throw new Error(
      `Unknown ${kind} provider "${choice}". Implemented: ${Object.keys(adapters).join(", ")}.`,
    );
  }
  return factory();
}

export async function collectProviderHealth(
  registry: ProviderRegistry,
): Promise<Record<string, { status: string; isMock: boolean; message?: string }>> {
  const entries = Object.entries(registry) as [ProviderName, ProviderRegistry[ProviderName]][];
  const results = await Promise.all(
    entries.map(async ([name, provider]) => {
      try {
        return [name, await provider.health()] as const;
      } catch (err) {
        return [
          name,
          { status: "error", isMock: provider.isMock, message: (err as Error).message },
        ] as const;
      }
    }),
  );
  return Object.fromEntries(results);
}
