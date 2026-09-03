import type { ProviderHealth, RouteRequest, RouteResult, RoutingProvider } from "../types";
import { haversineMeters, mockProvenance, seededValue } from "./shared";

/**
 * MockRoutingProvider — DEVELOPMENT ONLY.
 * Approximates road distance as great-circle distance inflated by a small
 * deterministic factor, and duration assuming a ~50 mph average.
 */
export class MockRoutingProvider implements RoutingProvider {
  readonly name = "mock";
  readonly isMock = true;

  async getRoute(request: RouteRequest): Promise<RouteResult> {
    const straight = haversineMeters(request.origin, request.destination);
    const seed = `${request.origin.latitude},${request.origin.longitude}->${request.destination.latitude},${request.destination.longitude}`;
    const roadFactor = seededValue(seed, 1.15, 1.35);
    const distanceMeters = Math.round(straight * roadFactor);
    const averageSpeedMps = 22.35; // ~50 mph
    return {
      distanceMeters,
      durationSeconds: Math.round(distanceMeters / averageSpeedMps),
      ...mockProvenance({ roadFactor: Number(roadFactor.toFixed(3)) }),
    };
  }

  async health(): Promise<ProviderHealth> {
    return { status: "ok", isMock: true, message: "mock routing provider (development)" };
  }
}
