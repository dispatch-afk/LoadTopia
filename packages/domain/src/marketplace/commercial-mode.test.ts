import { describe, expect, it } from "vitest";
import { assertValidCommercialMode, CommercialModeError } from "./commercial-mode";

describe("assertValidCommercialMode", () => {
  it("accepts PUBLISH_RATE with a posted rate", () => {
    expect(() =>
      assertValidCommercialMode({ commercialMode: "PUBLISH_RATE", postedRate: "4000.00" }),
    ).not.toThrow();
  });

  it("rejects PUBLISH_RATE with no rate", () => {
    expect(() =>
      assertValidCommercialMode({ commercialMode: "PUBLISH_RATE", postedRate: null }),
    ).toThrow(CommercialModeError);
    expect(() =>
      assertValidCommercialMode({ commercialMode: "PUBLISH_RATE", postedRate: undefined }),
    ).toThrow(CommercialModeError);
  });

  it("accepts REQUEST_OFFERS with no rate", () => {
    expect(() =>
      assertValidCommercialMode({ commercialMode: "REQUEST_OFFERS", postedRate: null }),
    ).not.toThrow();
  });

  it("rejects REQUEST_OFFERS carrying a posted rate", () => {
    expect(() =>
      assertValidCommercialMode({ commercialMode: "REQUEST_OFFERS", postedRate: "4000.00" }),
    ).toThrow(CommercialModeError);
  });

  it("carries a 400 statusCode and a stable code", () => {
    try {
      assertValidCommercialMode({ commercialMode: "PUBLISH_RATE", postedRate: null });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CommercialModeError);
      expect((err as CommercialModeError).statusCode).toBe(400);
      expect((err as CommercialModeError).code).toBe("INVALID_COMMERCIAL_MODE");
    }
  });
});
