import { LoadStatus } from "@loadtopia/shared";
import { describe, expect, it } from "vitest";
import {
  LoadValidationError,
  assertLoadWindows,
  validateLoadWindows,
  validatePostReadiness,
} from "./load-validation";

const t = (iso: string) => new Date(iso);

describe("validateLoadWindows", () => {
  it("accepts a well-ordered set of windows", () => {
    expect(
      validateLoadWindows({
        pickupWindowStart: t("2026-09-10T08:00:00Z"),
        pickupWindowEnd: t("2026-09-10T12:00:00Z"),
        deliveryWindowStart: t("2026-09-12T08:00:00Z"),
        deliveryWindowEnd: t("2026-09-12T17:00:00Z"),
      }),
    ).toEqual([]);
  });

  it("accepts partial windows (draft loads may be incomplete)", () => {
    expect(validateLoadWindows({ pickupWindowStart: t("2026-09-10T08:00:00Z") })).toEqual([]);
    expect(validateLoadWindows({})).toEqual([]);
  });

  it("rejects a pickup window whose end precedes its start", () => {
    const issues = validateLoadWindows({
      pickupWindowStart: t("2026-09-10T12:00:00Z"),
      pickupWindowEnd: t("2026-09-10T08:00:00Z"),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toBe("pickupWindowEnd");
  });

  it("rejects a delivery window whose end precedes its start", () => {
    const issues = validateLoadWindows({
      deliveryWindowStart: t("2026-09-12T17:00:00Z"),
      deliveryWindowEnd: t("2026-09-12T08:00:00Z"),
    });
    expect(issues.map((i) => i.path)).toContain("deliveryWindowEnd");
  });

  it("rejects delivery starting before pickup starts", () => {
    const issues = validateLoadWindows({
      pickupWindowStart: t("2026-09-12T08:00:00Z"),
      deliveryWindowStart: t("2026-09-10T08:00:00Z"),
    });
    expect(issues.map((i) => i.path)).toContain("deliveryWindowStart");
  });

  it("assertLoadWindows throws LoadValidationError with the issues attached", () => {
    try {
      assertLoadWindows({
        pickupWindowStart: t("2026-09-10T12:00:00Z"),
        pickupWindowEnd: t("2026-09-10T08:00:00Z"),
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LoadValidationError);
      expect((err as LoadValidationError).statusCode).toBe(400);
      expect((err as LoadValidationError).issues).toHaveLength(1);
    }
  });
});

describe("validatePostReadiness", () => {
  const complete = {
    status: LoadStatus.DRAFT,
    originLocationId: "o",
    destinationLocationId: "d",
    equipmentType: "DRY_VAN",
    commodity: "Palletized dry goods",
    weightLbs: 42000,
    pickupWindowStart: t("2026-09-10T08:00:00Z"),
    pickupWindowEnd: t("2026-09-10T12:00:00Z"),
    deliveryWindowStart: t("2026-09-12T08:00:00Z"),
    deliveryWindowEnd: t("2026-09-12T17:00:00Z"),
  };

  it("passes for a fully specified load", () => {
    expect(validatePostReadiness(complete)).toEqual([]);
  });

  it("flags every missing required field", () => {
    const issues = validatePostReadiness({
      ...complete,
      commodity: null,
      weightLbs: null,
      pickupWindowStart: null,
    });
    const paths = issues.map((i) => i.path);
    expect(paths).toContain("commodity");
    expect(paths).toContain("weightLbs");
    expect(paths).toContain("pickupWindowStart");
  });

  it("rejects a zero or negative weight", () => {
    expect(validatePostReadiness({ ...complete, weightLbs: 0 }).map((i) => i.path)).toContain(
      "weightLbs",
    );
  });

  it("also enforces window ordering", () => {
    const issues = validatePostReadiness({
      ...complete,
      deliveryWindowStart: t("2026-09-01T08:00:00Z"),
    });
    expect(issues.map((i) => i.path)).toContain("deliveryWindowStart");
  });
});
