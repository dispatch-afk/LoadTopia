import { describe, expect, it } from "vitest";
import { deriveLoadNumberPrefix, disambiguatePrefix, formatLoadNumber } from "./load-number";

describe("deriveLoadNumberPrefix", () => {
  it("uses word initials for multi-word names", () => {
    expect(deriveLoadNumberPrefix("Blue Ridge Carriers")).toBe("BRC");
    expect(deriveLoadNumberPrefix("Palermo Foods")).toBe("PF");
  });

  it("truncates a single long word", () => {
    expect(deriveLoadNumberPrefix("Transcontinental")).toBe("TRANSCON");
  });

  it("strips punctuation and diacritics", () => {
    expect(deriveLoadNumberPrefix("Açaí & Co.")).toBe("AC");
  });

  it("always yields a 2–8 char uppercase alnum token", () => {
    for (const name of ["A", "X1", "!!!", "  ", "Q", "Zeta"]) {
      const p = deriveLoadNumberPrefix(name || "Company");
      expect(p).toMatch(/^[A-Z0-9]{2,8}$/);
    }
  });
});

describe("disambiguatePrefix", () => {
  it("appends an incrementing suffix while staying within 8 chars", () => {
    expect(disambiguatePrefix("BRC", 1)).toBe("BRC2");
    expect(disambiguatePrefix("TRANSCON", 2)).toBe("TRANSCO3");
  });
});

describe("formatLoadNumber", () => {
  it("zero-pads the sequence to 5 digits", () => {
    expect(formatLoadNumber("BRC", 1)).toBe("BRC-00001");
    expect(formatLoadNumber("PF", 4242)).toBe("PF-04242");
  });

  it("does not truncate a sequence longer than the pad width", () => {
    expect(formatLoadNumber("PF", 1234567)).toBe("PF-1234567");
  });

  it("rejects an invalid prefix or sequence", () => {
    expect(() => formatLoadNumber("bad prefix", 1)).toThrow();
    expect(() => formatLoadNumber("BRC", 0)).toThrow();
    expect(() => formatLoadNumber("BRC", -1)).toThrow();
  });
});
