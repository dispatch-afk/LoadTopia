import { describe, expect, it } from "vitest";
import { computeExpiry, isExpired, threadShouldExpire } from "./offer-expiration";

const T0 = new Date("2026-09-10T12:00:00Z");

describe("offer expiration", () => {
  it("computeExpiry adds hours in UTC", () => {
    expect(computeExpiry(T0, 72).toISOString()).toBe("2026-09-13T12:00:00.000Z");
    expect(computeExpiry(T0, 1).toISOString()).toBe("2026-09-10T13:00:00.000Z");
  });

  it("isExpired is inclusive of the exact deadline", () => {
    const exp = new Date("2026-09-10T18:00:00Z");
    expect(isExpired(exp, new Date("2026-09-10T17:59:59Z"))).toBe(false);
    expect(isExpired(exp, new Date("2026-09-10T18:00:00Z"))).toBe(true);
    expect(isExpired(exp, new Date("2026-09-10T18:00:01Z"))).toBe(true);
    expect(isExpired(exp.toISOString(), new Date("2026-09-11T00:00:00Z"))).toBe(true);
  });

  it("threadShouldExpire only for an ACTIVE thread past its current round deadline", () => {
    const now = new Date("2026-09-11T00:00:00Z");
    const staleRound = { expiresAt: new Date("2026-09-10T18:00:00Z") };
    const freshRound = { expiresAt: new Date("2026-09-12T00:00:00Z") };

    expect(threadShouldExpire({ status: "ACTIVE" }, staleRound, now)).toBe(true);
    expect(threadShouldExpire({ status: "ACTIVE" }, freshRound, now)).toBe(false);
    expect(threadShouldExpire({ status: "ACTIVE" }, null, now)).toBe(false);
    expect(threadShouldExpire({ status: "ACCEPTED" }, staleRound, now)).toBe(false);
    expect(threadShouldExpire({ status: "WITHDRAWN" }, staleRound, now)).toBe(false);
  });
});
