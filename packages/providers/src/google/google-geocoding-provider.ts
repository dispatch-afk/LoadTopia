import { z } from "zod";
import type { GeocodeResult, GeocodingProvider, PostalAddress, ProviderHealth } from "../types";
import { fetchJson, GoogleProviderError, redactUrl, withRetry } from "./shared";

const GEOCODE_ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";

/**
 * Non-transient Geocoding API statuses that carry no result to use, mapped to
 * a stable internal code. `OK` is handled separately (has `results`).
 * `error_message` (when present) is Google's own human-readable detail — safe
 * to surface internally (never contains the key), unsafe to assume present.
 */
const NON_RETRYABLE_STATUS = new Set([
  "ZERO_RESULTS",
  "REQUEST_DENIED",
  "INVALID_REQUEST",
]);
const RETRYABLE_STATUS = new Set(["OVER_QUERY_LIMIT", "OVER_DAILY_LIMIT", "UNKNOWN_ERROR"]);

// Deliberately lenient (not `.strict()`): this validates a THIRD-PARTY
// response, not untrusted client input. Unknown/extra fields from Google are
// ignored rather than rejected, so a future Google field addition can't break
// this parser.
const GeocodingResponseSchema = z.object({
  status: z.string(),
  error_message: z.string().optional(),
  results: z
    .array(
      z.object({
        place_id: z.string().optional(),
        geometry: z.object({
          location: z.object({ lat: z.number(), lng: z.number() }),
        }),
      }),
    )
    .optional(),
});

export interface GoogleGeocodingProviderOptions {
  timeoutMs?: number;
  retries?: number;
  retryBaseDelayMs?: number;
  /** Injectable for tests — defaults to the global `fetch`. Never a live call in tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Real GeocodingProvider backed by the Google Maps Platform Geocoding API
 * (server-side only — the API key never leaves this process). Errors are
 * mapped to a typed {@link GoogleProviderError} and thrown; callers (see
 * `apps/api/src/modules/locations/locations.service.ts`) already catch and
 * log every GeocodingProvider failure without blocking location creation —
 * this adapter must never silently substitute a mock/synthetic coordinate.
 */
export class GoogleGeocodingProvider implements GeocodingProvider {
  readonly name = "google";
  readonly isMock = false;

  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly retryBaseDelayMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly apiKey: string,
    options: GoogleGeocodingProviderOptions = {},
  ) {
    if (!apiKey) throw new Error("GoogleGeocodingProvider requires an API key");
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.retries = options.retries ?? 1;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 300;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async geocode(address: PostalAddress): Promise<GeocodeResult> {
    const addressLine = [
      address.addressLine1,
      address.addressLine2,
      address.city,
      address.region,
      address.postalCode,
      address.country,
    ]
      .filter((part) => part && part.trim().length > 0)
      .join(", ");

    const url = new URL(GEOCODE_ENDPOINT);
    url.searchParams.set("address", addressLine);
    url.searchParams.set("key", this.apiKey);
    const requestUrl = url.toString();

    // The classic Geocoding API signals errors with HTTP 200 + a body-level
    // `status` field (not an HTTP error code), so the retry/transient
    // decision has to happen INSIDE the retried attempt, not after
    // `withRetry` resolves — otherwise a transient OVER_QUERY_LIMIT/
    // UNKNOWN_ERROR response would never actually be retried.
    const parsed = await withRetry(
      async () => {
        const body = await fetchJson(requestUrl, {
          method: "GET",
          timeoutMs: this.timeoutMs,
          fetchImpl: this.fetchImpl,
        });
        const result = GeocodingResponseSchema.safeParse(body);
        if (!result.success) {
          throw new GoogleProviderError(
            "MALFORMED_RESPONSE",
            `Geocoding response did not match the expected shape (request: ${redactUrl(requestUrl)})`,
            false,
          );
        }
        const data = result.data;
        if (data.status !== "OK") {
          if (RETRYABLE_STATUS.has(data.status)) {
            throw new GoogleProviderError(
              "QUOTA_EXCEEDED",
              data.error_message ?? `Geocoding quota/rate limit (status ${data.status})`,
              true,
            );
          }
          if (NON_RETRYABLE_STATUS.has(data.status)) {
            throw new GoogleProviderError(
              data.status,
              data.error_message ?? `Geocoding failed (status ${data.status})`,
              false,
            );
          }
          throw new GoogleProviderError(
            "UNKNOWN_STATUS",
            data.error_message ?? `Unrecognized geocoding status: ${data.status}`,
            false,
          );
        }
        return data;
      },
      { retries: this.retries, baseDelayMs: this.retryBaseDelayMs },
    );
    // `withRetry` only resolves here when `data.status === "OK"` — every
    // other status above threw and either retried or propagated.

    const first = parsed.results?.[0];
    if (!first) {
      throw new GoogleProviderError(
        "ZERO_RESULTS",
        "Geocoding returned OK with no results",
        false,
      );
    }

    return {
      point: { latitude: first.geometry.location.lat, longitude: first.geometry.location.lng },
      // LoadTopia's own address fields remain authoritative — we do not
      // substitute Google's formatted_address/address_components. This
      // mirrors MockGeocodingProvider exactly.
      normalizedAddress: { ...address, country: address.country || "US" },
      provider: this.name,
      isMock: false,
      retrievedAt: new Date().toISOString(),
      metadata: first.place_id ? { placeId: first.place_id } : undefined,
    };
  }

  async health(): Promise<ProviderHealth> {
    // Constructor already guarantees an API key is configured. A live call
    // here would spend a paid request on every /api/health hit, which the
    // integration explicitly must not do.
    return { status: "ok", isMock: false, message: "Google Geocoding API (configured)" };
  }
}
