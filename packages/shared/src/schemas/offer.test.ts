import { describe, expect, it } from "vitest";
import { bookAtPostedRateSchema, counterOfferSchema, createOfferSchema } from "./offer";

describe("createOfferSchema / counterOfferSchema — USD-only (Milestone 4 Phase 5)", () => {
  it("defaults currency to USD", () => {
    expect(createOfferSchema.parse({ amount: "1850.00" }).currency).toBe("USD");
    expect(counterOfferSchema.parse({ amount: "1750.00" }).currency).toBe("USD");
  });

  it("accepts an explicit USD currency", () => {
    expect(createOfferSchema.parse({ amount: "1850.00", currency: "USD" }).currency).toBe("USD");
  });

  it("rejects any non-USD currency — no commercial input may select another", () => {
    for (const bad of ["EUR", "GBP", "CAD"]) {
      expect(() => createOfferSchema.parse({ amount: "1850.00", currency: bad })).toThrow();
      expect(() => counterOfferSchema.parse({ amount: "1750.00", currency: bad })).toThrow();
    }
  });
});

describe("bookAtPostedRateSchema", () => {
  it("requires a positive confirmedRate", () => {
    expect(bookAtPostedRateSchema.parse({ confirmedRate: "4000.00" })).toEqual({
      confirmedRate: "4000.00",
    });
    expect(() => bookAtPostedRateSchema.parse({ confirmedRate: "0" })).toThrow();
    expect(() => bookAtPostedRateSchema.parse({})).toThrow();
  });

  it("rejects unknown fields — no currency selector, no client-chosen extras", () => {
    expect(() =>
      bookAtPostedRateSchema.parse({ confirmedRate: "4000.00", currency: "EUR" }),
    ).toThrow();
  });
});
