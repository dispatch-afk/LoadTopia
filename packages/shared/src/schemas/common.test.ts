import { describe, expect, it } from "vitest";
import { currencySchema, positiveMoneySchema } from "./common";

describe("currencySchema (USD-only platform invariant)", () => {
  it("accepts USD, and defaults to USD when omitted", () => {
    expect(currencySchema.parse("USD")).toBe("USD");
    expect(currencySchema.parse(undefined)).toBe("USD");
  });

  it("rejects any other currency code", () => {
    for (const bad of ["EUR", "GBP", "CAD", "MXN", "usd", "US$", ""]) {
      expect(() => currencySchema.parse(bad), bad).toThrow();
    }
  });
});

describe("positiveMoneySchema", () => {
  it("accepts a positive decimal amount with up to 2 places", () => {
    expect(positiveMoneySchema.parse("4000")).toBe("4000");
    expect(positiveMoneySchema.parse("4000.5")).toBe("4000.5");
    expect(positiveMoneySchema.parse("4000.50")).toBe("4000.50");
  });

  it("rejects zero, negative, and non-positive amounts", () => {
    expect(() => positiveMoneySchema.parse("0")).toThrow();
    expect(() => positiveMoneySchema.parse("0.00")).toThrow();
    expect(() => positiveMoneySchema.parse("-100")).toThrow();
  });

  it("rejects more than 2 decimal places", () => {
    expect(() => positiveMoneySchema.parse("4000.999")).toThrow();
  });
});
