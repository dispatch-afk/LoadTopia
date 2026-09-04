import { z } from "zod";
import type { ProviderHealth, RouteRequest, RouteResult, RoutingProvider } from "../types";
import { fetchJson, GoogleProviderError, withRetry } from "./shared";

const COMPUTE_ROUTES_ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";

/**
 * Phase 1 field mask: distance, duration, and the encoded polyline (returned
 * transiently on {@link RouteResult.encodedPolyline} — never persisted by any
 * current call site). Deliberately minimal: no traffic data, no legs/steps,
 * no localized text. `travelMode` stays `DRIVE` — see the class doc below.
 */
const FIELD_MASK = "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline";

const DURATION_PATTERN = /^(\d+(?:\.\d+)?)s$/;

// Lenient (not `.strict()`) for the same reason as the geocoding schema —
// this parses Google's response, not client input.
const RoutesResponseSchema = z.object({
  routes: z
    .array(
      z.object({
        distanceMeters: z.number().nonnegative(),
        duration: z.string().regex(DURATION_PATTERN),
        polyline: z.object({ encodedPolyline: z.string() }).optional(),
      }),
    )
    .optional(),
});

export interface GoogleRoutingProviderOptions {
  timeoutMs?: number;
  retries?: number;
  retryBaseDelayMs?: number;
  /** Injectable for tests — defaults to the global `fetch`. Never a live call in tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Real RoutingProvider backed by the Google Routes API `computeRoutes`
 * (`travelMode: DRIVE`).
 *
 * Phase 1 is real ROAD routing, not truck-restriction-aware routing: Google's
 * large-vehicle/`TRUCK` travel mode requires vehicle height/width/length/
 * weight/axle-count/hazmat data LoadTopia does not collect anywhere today,
 * and is a separately access-gated Google feature. `RouteRequest.equipmentType`
 * is accepted by the interface but intentionally unused here — sending it to
 * Google would misrepresent a DRIVE-mode route as truck-aware.
 */
export class GoogleRoutingProvider implements RoutingProvider {
  readonly name = "google";
  readonly isMock = false;

  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly retryBaseDelayMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly apiKey: string,
    options: GoogleRoutingProviderOptions = {},
  ) {
    if (!apiKey) throw new Error("GoogleRoutingProvider requires an API key");
    this.timeoutMs = options.timeoutMs ?? 9_000;
    this.retries = options.retries ?? 1;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 300;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getRoute(request: RouteRequest): Promise<RouteResult> {
    const body = JSON.stringify({
      origin: { location: { latLng: { latitude: request.origin.latitude, longitude: request.origin.longitude } } },
      destination: {
        location: {
          latLng: { latitude: request.destination.latitude, longitude: request.destination.longitude },
        },
      },
      travelMode: "DRIVE",
    });

    const parsed = await withRetry(
      async () => {
        const json = await fetchJson(COMPUTE_ROUTES_ENDPOINT, {
          method: "POST",
          timeoutMs: this.timeoutMs,
          fetchImpl: this.fetchImpl,
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": this.apiKey,
            "x-goog-fieldmask": FIELD_MASK,
          },
          body,
        });
        const result = RoutesResponseSchema.safeParse(json);
        if (!result.success) {
          throw new GoogleProviderError(
            "MALFORMED_RESPONSE",
            "Routes API response did not match the expected shape",
            false,
          );
        }
        return result.data;
      },
      { retries: this.retries, baseDelayMs: this.retryBaseDelayMs },
    );

    const route = parsed.routes?.[0];
    if (!route) {
      throw new GoogleProviderError("NO_ROUTE", "Routes API returned no route for this origin/destination", false);
    }

    const durationMatch = DURATION_PATTERN.exec(route.duration);
    const durationSecondsText = durationMatch?.[1];
    if (durationSecondsText === undefined) {
      throw new GoogleProviderError("MALFORMED_RESPONSE", "Routes API duration was not in the expected format", false);
    }

    const result: RouteResult = {
      distanceMeters: route.distanceMeters,
      durationSeconds: Math.round(Number.parseFloat(durationSecondsText)),
      provider: this.name,
      isMock: false,
      retrievedAt: new Date().toISOString(),
    };
    if (route.polyline?.encodedPolyline) {
      result.encodedPolyline = route.polyline.encodedPolyline;
    }
    return result;
  }

  async health(): Promise<ProviderHealth> {
    // Constructor already guarantees an API key is configured. A live call
    // here would spend a paid request on every /api/health hit, which the
    // integration explicitly must not do.
    return { status: "ok", isMock: false, message: "Google Routes API (configured, DRIVE mode)" };
  }
}
