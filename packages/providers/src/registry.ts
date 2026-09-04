import type { GeocodingProvider, ProviderName, ProviderRegistry, RoutingProvider } from "./types";
import { GoogleGeocodingProvider } from "./google/google-geocoding-provider";
import { GoogleRoutingProvider } from "./google/google-routing-provider";
import { resolveApiKey } from "./google/shared";
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
 * Google Maps Platform API key(s). `mapsApiKey` is the shared fallback;
 * `routesApiKey`/`geocodingApiKey` optionally override it per API. Resolution
 * (and the "no key configured" failure) happens inside `createProviderRegistry`,
 * at boot, via {@link resolveApiKey} — never lazily on first request.
 */
export interface GoogleCredentials {
  mapsApiKey?: string;
  routesApiKey?: string;
  geocodingApiKey?: string;
}

/**
 * Builds the concrete provider set from configuration.
 *
 * Every adapter is chosen ONCE, here, at boot. Selecting any value with no
 * matching adapter fails loudly (see `build` below) so a misconfigured
 * environment can never silently fall back to synthetic data in production —
 * there is deliberately no try-Google/catch/use-mock path anywhere in this
 * package.
 */
export function createProviderRegistry(
  selection: ProviderSelection,
  google: GoogleCredentials = {},
): ProviderRegistry {
  return {
    routing: build<RoutingProvider>("routing", selection.routing, {
      mock: () => new MockRoutingProvider(),
      google: () => new GoogleRoutingProvider(resolveApiKey(google.routesApiKey, google.mapsApiKey)),
    }),
    pricing: build("pricing", selection.pricing, { mock: () => new MockPricingProvider() }),
    geocoding: build<GeocodingProvider>("geocoding", selection.geocoding, {
      mock: () => new MockGeocodingProvider(),
      google: () =>
        new GoogleGeocodingProvider(resolveApiKey(google.geocodingApiKey, google.mapsApiKey)),
    }),
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
