import type { RouteRequest, RouteResult, RoutingProvider } from "@loadtopia/providers";
import { describe, expect, it, vi } from "vitest";
import { computeRouting } from "./routing";

const ORIGIN_COORDS = { latitude: 38.6558, longitude: -77.2517 }; // Woodbridge, VA
const DEST_COORDS = { latitude: 34.0736, longitude: -118.4004 }; // Beverly Hills, CA

function fakeProvider(isMock: boolean, name: string, result?: RouteResult): RoutingProvider {
  return {
    name,
    isMock,
    getRoute: vi.fn(
      async (_req: RouteRequest): Promise<RouteResult> =>
        result ?? {
          distanceMeters: 4_264_000,
          durationSeconds: 144_000,
          provider: name,
          isMock,
          retrievedAt: new Date().toISOString(),
        },
    ),
    health: vi.fn(async () => ({ status: "ok" as const, isMock })),
  };
}

const log = { warn: vi.fn() };

describe("computeRouting — mock-coordinate provenance guard", () => {
  it("1. real routing + mock origin: does not call the provider, returns null", async () => {
    const routing = fakeProvider(false, "google");
    const origin = { ...ORIGIN_COORDS, geocodedBy: "mock" };
    const destination = { ...DEST_COORDS, geocodedBy: "google" };

    const result = await computeRouting(routing, origin, destination, "DRY_VAN", log);

    expect(result).toBeNull();
    expect(routing.getRoute).not.toHaveBeenCalled();
  });

  it("2. real routing + mock destination: does not call the provider, returns null", async () => {
    const routing = fakeProvider(false, "google");
    const origin = { ...ORIGIN_COORDS, geocodedBy: "google" };
    const destination = { ...DEST_COORDS, geocodedBy: "mock" };

    const result = await computeRouting(routing, origin, destination, "DRY_VAN", log);

    expect(result).toBeNull();
    expect(routing.getRoute).not.toHaveBeenCalled();
  });

  it("3. real routing + both endpoints mock: does not call the provider, returns null", async () => {
    const routing = fakeProvider(false, "google");
    const origin = { ...ORIGIN_COORDS, geocodedBy: "mock" };
    const destination = { ...DEST_COORDS, geocodedBy: "mock" };

    const result = await computeRouting(routing, origin, destination, "DRY_VAN", log);

    expect(result).toBeNull();
    expect(routing.getRoute).not.toHaveBeenCalled();
  });

  it("4. mock routing + mock endpoints: unaffected — existing deterministic behavior still runs", async () => {
    const routing = fakeProvider(true, "mock");
    const origin = { ...ORIGIN_COORDS, geocodedBy: "mock" };
    const destination = { ...DEST_COORDS, geocodedBy: "mock" };

    const result = await computeRouting(routing, origin, destination, "DRY_VAN", log);

    expect(routing.getRoute).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
    expect(result!.distanceMeters).toBeGreaterThan(0);
  });

  it("5. real routing + both endpoints genuinely non-mock: calls the provider, persists a valid distance", async () => {
    const routing = fakeProvider(false, "google");
    const origin = { ...ORIGIN_COORDS, geocodedBy: "google" };
    const destination = { ...DEST_COORDS, geocodedBy: "google" };

    const result = await computeRouting(routing, origin, destination, "DRY_VAN", log);

    expect(routing.getRoute).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      distanceMeters: 4_264_000,
      driveTimeMinutes: 2_400,
      provider: "google",
      routedAt: expect.any(Date),
    });
  });

  it("does not block on unknown/null provenance — only the explicit mock marker is guarded", async () => {
    const routing = fakeProvider(false, "google");
    const origin = { ...ORIGIN_COORDS, geocodedBy: null };
    const destination = { ...DEST_COORDS, geocodedBy: "google" };

    const result = await computeRouting(routing, origin, destination, "DRY_VAN", log);

    expect(routing.getRoute).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
  });

  it("still returns null (pre-existing behavior) when coordinates are missing, before the provenance check runs", async () => {
    const routing = fakeProvider(false, "google");
    const origin = { latitude: null, longitude: null, geocodedBy: "google" };
    const destination = { ...DEST_COORDS, geocodedBy: "google" };

    const result = await computeRouting(routing, origin, destination, "DRY_VAN", log);

    expect(result).toBeNull();
    expect(routing.getRoute).not.toHaveBeenCalled();
  });

  it("never throws a client-visible error from the guard — resolves to null", async () => {
    const routing = fakeProvider(false, "google");
    const origin = { ...ORIGIN_COORDS, geocodedBy: "mock" };
    const destination = { ...DEST_COORDS, geocodedBy: "mock" };

    await expect(
      computeRouting(routing, origin, destination, "DRY_VAN", log),
    ).resolves.toBeNull();
  });
});
