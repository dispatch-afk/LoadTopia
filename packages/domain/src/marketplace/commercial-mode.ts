import { LoadCommercialMode } from "@loadtopia/shared";

/**
 * Commercial-mode validation (Milestone 4 Phase 5). Schema-level checks
 * (positive USD amount, correct type) live in @loadtopia/shared's Zod
 * schemas; this is the CROSS-FIELD invariant that only makes sense against
 * the load's MERGED state (existing + patch), which a partial `update` can
 * never fully express at the schema layer alone:
 *
 *   PUBLISH_RATE  -> postedRate MUST be present (a binding USD rate)
 *   REQUEST_OFFERS -> postedRate MUST be absent (null)
 *
 * Mock/estimated market pricing (PricingSnapshot) is a completely separate
 * model with no call site that ever reaches this function — there is no
 * code path by which it could become a binding `postedRate`.
 */
export class CommercialModeError extends Error {
  readonly code = "INVALID_COMMERCIAL_MODE";
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "CommercialModeError";
  }
}

export interface CommercialModeInput {
  commercialMode: LoadCommercialMode;
  /** Decimal string, or null/undefined when no rate is set. */
  postedRate: string | null | undefined;
}

export function assertValidCommercialMode(input: CommercialModeInput): void {
  const hasRate = input.postedRate != null;
  if (input.commercialMode === LoadCommercialMode.PUBLISH_RATE && !hasRate) {
    throw new CommercialModeError(
      "Publishing a rate requires a binding USD rate — enter an amount, or choose Request Offers.",
    );
  }
  if (input.commercialMode === LoadCommercialMode.REQUEST_OFFERS && hasRate) {
    throw new CommercialModeError(
      "Request Offers cannot carry a posted rate — clear it, or choose Publish a Rate.",
    );
  }
}
