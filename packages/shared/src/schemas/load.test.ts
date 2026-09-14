import { describe, expect, it } from "vitest";
import { createLoadSchema, updateLoadSchema } from "./load";

const base = {
  originLocationId: "11111111-1111-1111-1111-111111111111",
  destinationLocationId: "22222222-2222-2222-2222-222222222222",
  equipmentType: "DRY_VAN",
};

describe("createLoadSchema — commercial fields (Milestone 4 Phase 5)", () => {
  it("defaults commercialMode to REQUEST_OFFERS with no postedRate", () => {
    const p = createLoadSchema.parse(base);
    expect(p.commercialMode).toBe("REQUEST_OFFERS");
    expect(p.postedRate).toBeUndefined();
  });

  it("accepts an explicit PUBLISH_RATE with a positive USD rate", () => {
    const p = createLoadSchema.parse({ ...base, commercialMode: "PUBLISH_RATE", postedRate: "4000.00" });
    expect(p.commercialMode).toBe("PUBLISH_RATE");
    expect(p.postedRate).toBe("4000.00");
  });

  it("rejects a non-positive or malformed posted rate at the schema layer", () => {
    expect(() =>
      createLoadSchema.parse({ ...base, commercialMode: "PUBLISH_RATE", postedRate: "0" }),
    ).toThrow();
    expect(() =>
      createLoadSchema.parse({ ...base, commercialMode: "PUBLISH_RATE", postedRate: "abc" }),
    ).toThrow();
  });

  it("rejects an unknown commercialMode value", () => {
    expect(() => createLoadSchema.parse({ ...base, commercialMode: "AUCTION" })).toThrow();
  });
});

describe("updateLoadSchema — commercial fields", () => {
  it("allows postedRate to be explicitly cleared with null", () => {
    const p = updateLoadSchema.parse({ commercialMode: "REQUEST_OFFERS", postedRate: null });
    expect(p.postedRate).toBeNull();
  });

  it("allows a partial update touching only postedRate", () => {
    const p = updateLoadSchema.parse({ postedRate: "4500.00" });
    expect(p.postedRate).toBe("4500.00");
    expect(p.commercialMode).toBeUndefined();
  });
});
