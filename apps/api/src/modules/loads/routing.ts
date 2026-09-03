import type { RoutingProvider } from "@loadtopia/providers";

export interface RoutingResult {
  distanceMeters: number;
  driveTimeMinutes: number;
  provider: string;
  routedAt: Date;
}

interface Coords {
  latitude: unknown;
  longitude: unknown;
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
