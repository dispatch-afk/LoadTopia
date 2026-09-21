import { describe, expect, it } from "vitest";
import { computeTimingWarning } from "./timing-warning";

describe("computeTimingWarning", () => {
  it("returns null when there is no pickup window to compare against", () => {
    expect(computeTimingWarning(new Date("2026-09-13T00:00:00Z"), null)).toBeNull();
  });

  it("returns null when the release is comfortably before pickup", () => {
    const release = new Date("2026-09-13T00:00:00Z");
    const pickup = new Date("2026-09-14T00:00:00Z"); // 24h later
    expect(computeTimingWarning(release, pickup)).toBeNull();
  });

  it("warns with the exact minute count when the release is close to pickup", () => {
    const release = new Date("2026-09-13T12:00:00Z");
    const pickup = new Date("2026-09-13T12:45:00Z"); // 45 minutes later
    const warning = computeTimingWarning(release, pickup);
    expect(warning).toEqual({ minutesBeforePickup: 45 });
  });

  it("reports a negative margin when the release lands after pickup begins", () => {
    const release = new Date("2026-09-13T13:00:00Z");
    const pickup = new Date("2026-09-13T12:00:00Z"); // 1h earlier
    const warning = computeTimingWarning(release, pickup);
    expect(warning).toEqual({ minutesBeforePickup: -60 });
  });
});
