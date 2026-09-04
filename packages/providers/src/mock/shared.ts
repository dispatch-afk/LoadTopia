import type { ProviderProvenance } from "../types";

export const MOCK_PROVIDER_NAME = "mock";

export const MOCK_DISCLAIMER =
  "DEVELOPMENT MOCK DATA — deterministic synthetic values, NOT live market data. " +
  "Never present to end users as real pricing, routing, or tracking information.";

export const MOCK_VERIFICATION_DISCLAIMER =
  "[MOCK] deterministic development verification — NOT FMCSA, DOT, SAFER, " +
  "insurance, or any government verification. Do not represent as such.";

/** Health message prefix so mock providers are unmistakable in system output. */
export const mockHealthMessage = (what: string) =>
  `[MOCK] ${what} — deterministic development data, not real-world data`;

export function mockProvenance(metadata?: Record<string, unknown>): ProviderProvenance {
  return {
    provider: MOCK_PROVIDER_NAME,
    isMock: true,
    retrievedAt: new Date().toISOString(),
    metadata: { note: MOCK_DISCLAIMER, ...metadata },
  };
}

/** Small deterministic hash so mock outputs are stable for the same inputs. */
export function seededValue(seed: string, min: number, max: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const unit = (h >>> 0) / 0xffffffff;
  return min + unit * (max - min);
}

export function haversineMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
