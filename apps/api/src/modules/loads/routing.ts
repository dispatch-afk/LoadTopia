import { MOCK_PROVIDER_NAME, type RoutingProvider } from "@loadtopia/providers";

export interface RoutingResult {
  distanceMeters: number;
  driveTimeMinutes: number;
  provider: string;
  routedAt: Date;
}

interface Coords {
  latitude: unknown;
  longitude: unknown;
  /**
   * The geocoding provider name stored on this Location at geocode time
   * (`Location.geocodedBy`) — NOT the currently configured provider. `null`
   * means "never successfully geocoded" (which already implies null lat/lng,
   * caught below) or, in principle, an unknown/legacy source; there is no
   * evidence a null value ever means "known-mock", so it is treated as
   * unrestricted here rather than broadening this guard beyond the confirmed
   * bug (persisted coordinates whose provenance is EXPLICITLY "mock").
   */
  geocodedBy: string | null;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v.toString());
  return Number.isFinite(n) ? n : null;
}

/**
 * Compute distance + drive time via the RoutingProvider abstraction. Requires
 * both endpoints to be geocoded; returns null (and the load is stored without
 * mileage) if they are not, or if the provider call fails. Never throws.
 *
 * Coordinate-provenance guard: a REAL (non-mock) routing provider must never
 * be asked to route between coordinates that are known to have come from
 * MockGeocodingProvider — those lat/lngs are deterministic pseudo-random
 * points within the continental US, not the location's real address. Google
 * would happily return a "successful" route between them, and the load would
 * then be stored/labeled as a real (`isMock: false`) route, even though its
 * endpoints are fabricated. This guard makes that impossible: it declines to
 * call the provider at all and returns the same "not yet routable" result any
 * other routing precondition failure produces — never a re-geocode, never a
 * silent substitution of mock routing, never a thrown/client-visible error.
 * Mock routing is completely unaffected (local/CI/tests never hit this).
 */
export async function computeRouting(
  routing: RoutingProvider,
  origin: Coords,
  destination: Coords,
  equipmentType: string | undefined,
  log: { warn: (obj: unknown, msg: string) => void },
): Promise<RoutingResult | null> {
  const oLat = num(origin.latitude);
  const oLng = num(origin.longitude);
  const dLat = num(destination.latitude);
  const dLng = num(destination.longitude);
  if (oLat == null || oLng == null || dLat == null || dLng == null) return null;

  if (
    !routing.isMock &&
    (origin.geocodedBy === MOCK_PROVIDER_NAME || destination.geocodedBy === MOCK_PROVIDER_NAME)
  ) {
    log.warn(
      { routingProvider: routing.name },
      "refusing to route: origin/destination coordinates were geocoded by the mock provider; load stored without mileage",
    );
    return null;
  }

  try {
    const result = await routing.getRoute({
      origin: { latitude: oLat, longitude: oLng },
      destination: { latitude: dLat, longitude: dLng },
      equipmentType,
    });
    return {
      distanceMeters: Math.round(result.distanceMeters),
      driveTimeMinutes: Math.round(result.durationSeconds / 60),
      provider: result.provider,
      routedAt: new Date(),
    };
  } catch (err) {
    log.warn({ err }, "routing provider call failed; load stored without mileage");
    return null;
  }
}
