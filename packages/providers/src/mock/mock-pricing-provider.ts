import type { PriceEstimate, PriceEstimateRequest, PricingProvider, ProviderHealth } from "../types";
import { MOCK_DISCLAIMER, mockProvenance, seededValue } from "./shared";

/**
 * MockPricingProvider — DEVELOPMENT ONLY.
 *
 * Produces a deterministic synthetic rate band from the lane + equipment. This
 * is NOT market data. Every response carries `isMock: true` and a non-null
 * `disclaimer`; the API and UI must surface that text and must never label mock
 * output as "market rate".
 */
export class MockPricingProvider implements PricingProvider {
  readonly name = "mock";
  readonly isMock = true;

  async estimate(request: PriceEstimateRequest): Promise<PriceEstimate> {
    const miles =
      request.distanceMeters != null ? request.distanceMeters / 1609.344 : this.laneMiles(request);
    const seed = `${request.originRegion}|${request.destinationRegion}|${request.equipmentType}`;
    const rpm = seededValue(seed, 1.6, 3.4);
    const mid = miles * rpm;
    const low = mid * 0.85;
    const high = mid * 1.2;
    const money = (n: number) => n.toFixed(2);
    return {
      currency: "USD",
      lowRate: money(low),
      midRate: money(mid),
      highRate: money(high),
      ratePerMile: rpm.toFixed(4),
      confidence: "low",
      disclaimer: MOCK_DISCLAIMER,
      ...mockProvenance({ estimatedMiles: Math.round(miles) }),
    };
  }

  private laneMiles(request: PriceEstimateRequest): number {
    return Math.round(seededValue(`${request.originRegion}|${request.destinationRegion}`, 150, 2200));
  }

  async health(): Promise<ProviderHealth> {
    return { status: "ok", isMock: true, message: "mock pricing provider (development)" };
  }
}
