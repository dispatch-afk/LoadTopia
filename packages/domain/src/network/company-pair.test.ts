import { describe, expect, it } from "vitest";
import { canonicalizeCompanyPair, otherCompanyInPair } from "./company-pair";
import { NetworkError } from "./errors";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

describe("canonicalizeCompanyPair", () => {
  it("orders the pair deterministically regardless of argument order", () => {
    expect(canonicalizeCompanyPair(A, B)).toEqual({ companyAId: A, companyBId: B });
    expect(canonicalizeCompanyPair(B, A)).toEqual({ companyAId: A, companyBId: B });
  });

  it("rejects a company forming a pair with itself", () => {
    expect(() => canonicalizeCompanyPair(A, A)).toThrow(NetworkError);
  });

  it("is stable across many random orderings of the same two ids", () => {
    for (let i = 0; i < 10; i++) {
      const [x, y] = i % 2 === 0 ? [A, B] : [B, A];
      expect(canonicalizeCompanyPair(x, y)).toEqual({ companyAId: A, companyBId: B });
    }
  });
});

describe("otherCompanyInPair", () => {
  const pair = canonicalizeCompanyPair(A, B);

  it("returns the other company for either side of the pair", () => {
    expect(otherCompanyInPair(pair, A)).toBe(B);
    expect(otherCompanyInPair(pair, B)).toBe(A);
  });

  it("throws for a company not in the pair", () => {
    const stranger = "33333333-3333-3333-3333-333333333333";
    expect(() => otherCompanyInPair(pair, stranger)).toThrow(NetworkError);
  });
});
