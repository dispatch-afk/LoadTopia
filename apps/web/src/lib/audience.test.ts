import { describe, expect, it } from "vitest";
import {
  audienceSummaryText,
  computeTimingWarningMinutes,
  nextReleaseText,
  presetReleaseAt,
  timingWarningText,
} from "./audience";

describe("presetReleaseAt", () => {
  it("computes an absolute timestamp N hours from the given moment", () => {
    const from = new Date("2026-09-13T12:00:00.000Z");
    expect(presetReleaseAt(4, from).toISOString()).toBe("2026-09-13T16:00:00.000Z");
  });
});

describe("audienceSummaryText", () => {
  it("labels a legacy (no-strategy) load as Marketplace", () => {
    expect(audienceSummaryText(null)).toBe("Marketplace");
  });

  it("labels each current stage factually", () => {
    expect(
      audienceSummaryText({ strategy: "SELECTED_FIRST", currentStage: "SELECTED", nextReleaseAt: null }),
    ).toBe("Selected carriers");
    expect(
      audienceSummaryText({ strategy: "NETWORK_FIRST", currentStage: "NETWORK", nextReleaseAt: null }),
    ).toBe("Carrier Network");
  });
});

describe("nextReleaseText", () => {
  it("is truthful when nothing is scheduled", () => {
    expect(nextReleaseText(null)).toBe("No automatic release scheduled");
  });

  it("shows the exact timestamp when a release is scheduled", () => {
    expect(nextReleaseText("2026-09-14T19:30:00.000Z")).not.toBe("No automatic release scheduled");
  });
});

describe("computeTimingWarningMinutes", () => {
  it("returns null when there is no pickup window", () => {
    expect(computeTimingWarningMinutes(new Date("2026-09-13T00:00:00Z"), null)).toBeNull();
  });

  it("returns null when the margin is comfortable", () => {
    const release = new Date("2026-09-13T00:00:00Z");
    expect(computeTimingWarningMinutes(release, "2026-09-14T00:00:00Z")).toBeNull();
  });

  it("returns the exact minute count when close to pickup", () => {
    const release = new Date("2026-09-13T12:00:00Z");
    expect(computeTimingWarningMinutes(release, "2026-09-13T12:45:00Z")).toBe(45);
  });
});

describe("timingWarningText", () => {
  it("never predicts failure or says the load may be late", () => {
    const text = timingWarningText(45);
    expect(text.toLowerCase()).not.toMatch(/late|fail|risk/);
    expect(text).toContain("45 minutes");
    expect(text).toContain("before the pickup window begins");
  });

  it("describes a release scheduled after pickup begins factually", () => {
    const text = timingWarningText(-60);
    expect(text).toContain("after the pickup window begins");
  });
});
