import { describe, expect, it } from "vitest";
import { isCompanyWideScope, isLoadInFacilityScope, isLocationInScope } from "./facility-scope";

describe("isCompanyWideScope", () => {
  it("is true with no scope rows", () => {
    expect(isCompanyWideScope([])).toBe(true);
  });

  it("is false with any scope row", () => {
    expect(isCompanyWideScope([{ locationId: "loc-1" }])).toBe(false);
  });
});

describe("isLocationInScope", () => {
  it("allows any location under company-wide scope", () => {
    expect(isLocationInScope([], "loc-1")).toBe(true);
  });

  it("allows only listed locations under restricted scope", () => {
    const rows = [{ locationId: "loc-1" }, { locationId: "loc-2" }];
    expect(isLocationInScope(rows, "loc-1")).toBe(true);
    expect(isLocationInScope(rows, "loc-3")).toBe(false);
  });
});

describe("isLoadInFacilityScope", () => {
  const load = { originLocationId: "loc-origin", destinationLocationId: "loc-dest" };

  it("allows any load under company-wide scope", () => {
    expect(isLoadInFacilityScope([], load)).toBe(true);
  });

  it("allows a load when only the origin is in scope", () => {
    expect(isLoadInFacilityScope([{ locationId: "loc-origin" }], load)).toBe(true);
  });

  it("allows a load when only the destination is in scope", () => {
    expect(isLoadInFacilityScope([{ locationId: "loc-dest" }], load)).toBe(true);
  });

  it("rejects a load when neither endpoint is in scope", () => {
    expect(isLoadInFacilityScope([{ locationId: "loc-other" }], load)).toBe(false);
  });
});
