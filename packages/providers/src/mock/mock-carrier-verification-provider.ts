import type {
  CarrierVerificationProvider,
  CarrierVerificationRequest,
  CarrierVerificationResult,
  ProviderHealth,
} from "../types";
import { MOCK_VERIFICATION_DISCLAIMER, mockHealthMessage, mockProvenance, seededValue } from "./shared";

/**
 * [MOCK] CarrierVerificationProvider — DEVELOPMENT ONLY.
 *
 * Deterministic synthetic verdict from the carrier's MC/DOT/name. It does NOT
 * contact FMCSA / SAFER / any insurance or government source, and every result
 * carries `isMock: true` + a disclaimer that is surfaced verbatim in carrier,
 * admin, and system output. A carrier with neither an MC nor a DOT number is
 * always `not_found`; otherwise ~85% deterministically pass with active
 * authority, the rest fail.
 */
export class MockCarrierVerificationProvider implements CarrierVerificationProvider {
  readonly name = "mock";
  readonly isMock = true;

  async verify(request: CarrierVerificationRequest): Promise<CarrierVerificationResult> {
    const key = `${request.mcNumber ?? ""}|${request.dotNumber ?? ""}|${request.legalName}`;
    const provenance = mockProvenance({ mode: "carrier-verification" });

    if (!request.mcNumber && !request.dotNumber) {
      return {
        status: "not_found",
        authorityStatus: "unknown",
        insuranceOnFile: null,
        reference: null,
        disclaimer: MOCK_VERIFICATION_DISCLAIMER,
        ...provenance,
      };
    }

    const roll = seededValue(key, 0, 1);
    const passes = roll < 0.85;
    return {
      status: passes ? "verified" : "failed",
      authorityStatus: passes ? "active" : "inactive",
      insuranceOnFile: passes ? true : false,
      reference: `MOCK-VER-${Math.abs(hash(key)).toString(36).toUpperCase().slice(0, 8)}`,
      disclaimer: MOCK_VERIFICATION_DISCLAIMER,
      ...provenance,
    };
  }

  async health(): Promise<ProviderHealth> {
    return { status: "ok", isMock: true, message: mockHealthMessage("CarrierVerificationProvider") };
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}
