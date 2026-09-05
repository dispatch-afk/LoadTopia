import { describe, expect, it } from "vitest";
import { renderRateConfirmationPdf, type RateConfirmationDocModel } from "./rate-confirmation.pdf";

const FULL: RateConfirmationDocModel = {
  referenceNumber: "RC-PALERMO-00042",
  awardedAt: new Date("2026-09-05T14:07:03.000Z"),
  agreedRate: { toFixed: (n: number) => (1850).toFixed(n) },
  currency: "USD",
  distanceMeters: 1_207_008, // ~750 mi
  shipperCompanyName: "Palermo Foods",
  shipperMcNumber: "MC123456",
  shipperDotNumber: "DOT7654321",
  carrierCompanyName: "Sunrise Carriers",
  carrierLegalName: "Sunrise Carriers LLC",
  carrierMcNumber: "MC100001",
  carrierDotNumber: "DOT2000001",
  originAddressLine1: "1 Dock St",
  originAddressLine2: "Bldg C",
  originCity: "Chicago",
  originState: "IL",
  originPostalCode: "60601",
  originCountry: "US",
  destinationAddressLine1: "500 Industrial Blvd",
  destinationAddressLine2: null,
  destinationCity: "Dallas",
  destinationState: "TX",
  destinationPostalCode: "75201",
  destinationCountry: "US",
  pickupWindowStart: new Date("2026-09-08T13:00:00.000Z"),
  pickupWindowEnd: new Date("2026-09-08T21:00:00.000Z"),
  deliveryWindowStart: new Date("2026-09-10T13:00:00.000Z"),
  deliveryWindowEnd: new Date("2026-09-10T22:00:00.000Z"),
  equipmentType: "DRY_VAN",
  commodity: "Palletized dry goods",
  weightLbs: 38000,
};

const SPARSE: RateConfirmationDocModel = {
  ...FULL,
  referenceNumber: "RC-SPARSE-00001",
  shipperMcNumber: null,
  shipperDotNumber: null,
  carrierLegalName: null,
  carrierMcNumber: null,
  carrierDotNumber: null,
  originAddressLine2: null,
  distanceMeters: null,
  pickupWindowStart: null,
  pickupWindowEnd: null,
  deliveryWindowStart: null,
  deliveryWindowEnd: null,
  commodity: null,
  weightLbs: null,
};

const text = (b: Uint8Array) => Buffer.from(b).toString("latin1");

describe("renderRateConfirmationPdf", () => {
  it("produces a syntactically well-formed single-page PDF", () => {
    const pdf = renderRateConfirmationPdf(FULL);
    const s = text(pdf);
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(s).toContain("/Type /Catalog");
    expect(s).toContain("/Count 1");
    expect(s).toContain("xref");
    expect(s).toContain("startxref");
    expect(pdf.byteLength).toBeGreaterThan(600);
  });

  it("is byte-for-byte deterministic: the same immutable snapshot renders identically", () => {
    const a = renderRateConfirmationPdf(FULL);
    const b = renderRateConfirmationPdf(FULL);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("renders the authoritative commercial facts from the snapshot", () => {
    const s = text(renderRateConfirmationPdf(FULL));
    expect(s).toContain("LoadTopia Rate Confirmation");
    expect(s).toContain("RC-PALERMO-00042");
    expect(s).toContain("Palermo Foods");
    expect(s).toContain("Sunrise Carriers LLC");
    expect(s).toContain("MC100001");
    expect(s).toContain("DOT2000001");
    expect(s).toContain("MC123456");
    expect(s).toContain("Chicago");
    expect(s).toContain("Dallas");
    expect(s).toContain("DRY_VAN");
    expect(s).toContain("Palletized dry goods");
    expect(s).toContain("38,000 lbs");
    expect(s).toContain("750 mi");
    expect(s).toContain("1850.00 USD");
    expect(s).toContain("2026-09-05 14:07 UTC");
  });

  it("never invents contractual terms LoadTopia does not hold", () => {
    const s = text(renderRateConfirmationPdf(FULL)).toLowerCase();
    for (const forbidden of [
      "detention",
      "layover",
      "lumper",
      "quick pay",
      "quick-pay",
      "indemnif",
      "governing law",
      "cancellation fee",
      "insurance",
      "signature",
      "net 30",
      "broker",
    ]) {
      expect(s, forbidden).not.toContain(forbidden);
    }
  });

  it("renders a snapshot with every optional value absent without throwing", () => {
    const pdf = renderRateConfirmationPdf(SPARSE);
    const s = text(pdf);
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s).toContain("RC-SPARSE-00001");
    expect(s).toContain("Not specified"); // empty pickup/delivery windows
    // absent MC/DOT/commodity render as a dash, never a fabricated value
    expect(s).not.toContain("null");
    expect(s).not.toContain("undefined");
  });

  it("clamps an absurdly long field instead of overflowing the page", () => {
    const pdf = renderRateConfirmationPdf({ ...FULL, commodity: "X".repeat(5000) });
    expect(pdf.byteLength).toBeLessThan(4000);
  });
});
