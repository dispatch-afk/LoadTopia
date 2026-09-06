import { describe, expect, it } from "vitest";
import { createCheckInSchema } from "./check-in";

const ok = { city: "Chicago", state: "IL" };

describe("createCheckInSchema", () => {
  it("accepts a minimal city/state check-in", () => {
    expect(createCheckInSchema.parse(ok)).toEqual({ city: "Chicago", state: "IL" });
  });

  it("trims city and note; upper-cases the state", () => {
    const p = createCheckInSchema.parse({
      city: "  Dallas ",
      state: "tx",
      note: "  running late  ",
    });
    expect(p.city).toBe("Dallas");
    expect(p.state).toBe("TX");
    expect(p.note).toBe("running late");
  });

  it("requires city and state, rejecting empty-after-trim", () => {
    expect(() => createCheckInSchema.parse({ state: "IL" })).toThrow();
    expect(() => createCheckInSchema.parse({ city: "Chicago" })).toThrow();
    expect(() => createCheckInSchema.parse({ city: "   ", state: "IL" })).toThrow();
    expect(() => createCheckInSchema.parse({ city: "Chicago", state: "  " })).toThrow();
  });

  it("bounds the note length", () => {
    expect(() => createCheckInSchema.parse({ ...ok, note: "x".repeat(1001) })).toThrow();
    expect(createCheckInSchema.parse({ ...ok, note: "x".repeat(1000) }).note).toHaveLength(1000);
  });

  it("rejects unknown fields (loadId / actorUserId / recordedAt are server-authoritative)", () => {
    for (const extra of [
      { loadId: "x" },
      { actorUserId: "x" },
      { actorCompanyId: "x" },
      { recordedAt: new Date().toISOString() },
      { createdAt: new Date().toISOString() },
      { id: "x" },
    ]) {
      expect(() => createCheckInSchema.parse({ ...ok, ...extra }), JSON.stringify(extra)).toThrow();
    }
  });

  it("enforces latitude / longitude range", () => {
    expect(() => createCheckInSchema.parse({ ...ok, latitude: 91, longitude: 0 })).toThrow();
    expect(() => createCheckInSchema.parse({ ...ok, latitude: -90.1, longitude: 0 })).toThrow();
    expect(() => createCheckInSchema.parse({ ...ok, latitude: 0, longitude: 180.5 })).toThrow();
    expect(() => createCheckInSchema.parse({ ...ok, latitude: 0, longitude: -181 })).toThrow();
  });

  it("rejects non-finite coordinates", () => {
    expect(() =>
      createCheckInSchema.parse({ ...ok, latitude: Number.NaN, longitude: 0 }),
    ).toThrow();
    expect(() =>
      createCheckInSchema.parse({ ...ok, latitude: Number.POSITIVE_INFINITY, longitude: 0 }),
    ).toThrow();
  });

  it("requires latitude and longitude together — never half a pair", () => {
    expect(() => createCheckInSchema.parse({ ...ok, latitude: 41.88 })).toThrow();
    expect(() => createCheckInSchema.parse({ ...ok, longitude: -87.63 })).toThrow();
    expect(createCheckInSchema.parse({ ...ok, latitude: 41.88, longitude: -87.63 })).toMatchObject({
      latitude: 41.88,
      longitude: -87.63,
    });
    expect(createCheckInSchema.parse(ok)).not.toHaveProperty("latitude");
  });
});
