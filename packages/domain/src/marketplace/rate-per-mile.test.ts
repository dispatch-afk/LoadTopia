import { describe, expect, it } from "vitest";
import { computeRatePerMile } from "./rate-per-mile";

describe("computeRatePerMile", () => {
  it("divides the posted rate by miles, rounded to 2 decimals", () => {
    expect(computeRatePerMile("4000.00", 1834.9)).toBe("2.18");
    expect(computeRatePerMile(4000, 1834.9)).toBe("2.18");
  });

  it("returns null when the rate is missing", () => {
    expect(computeRatePerMile(null, 1000)).toBeNull();
  });

  it("returns null when miles is missing, zero, or negative", () => {
    expect(computeRatePerMile("1000.00", null)).toBeNull();
    expect(computeRatePerMile("1000.00", 0)).toBeNull();
    expect(computeRatePerMile("1000.00", -5)).toBeNull();
  });

  it("returns null for a non-numeric rate rather than NaN", () => {
    expect(computeRatePerMile("not-a-number", 1000)).toBeNull();
  });
});
