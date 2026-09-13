import { LoadAudienceStage, LoadAudienceStrategyType } from "@loadtopia/shared";
import { stageOrdinal } from "./stage";

export class AudienceValidationError extends Error {
  readonly code = "VALIDATION_ERROR";
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "AudienceValidationError";
  }
}

export interface RequestedRelease {
  toStage: LoadAudienceStage;
  /** Absolute timestamp, as computed and displayed to the shipper on the
   *  Review screen — never re-derived server-side from an hours offset, so
   *  what the shipper saw is exactly what gets scheduled. */
  releaseAt: Date;
}

/**
 * Validates a shipper's requested release chain against their chosen
 * strategy:
 *   MARKETPLACE     — no releases (already at its final stage).
 *   NETWORK_FIRST    — zero or one release, always targeting MARKETPLACE.
 *   SELECTED_FIRST   — zero, one, or two releases. A single release may
 *     target NETWORK ("broaden to my network, then decide later") OR jump
 *     straight to MARKETPLACE ("release directly to Marketplace"). Two
 *     releases must be exactly [NETWORK, MARKETPLACE] in that order — the
 *     chained "Selected → Network → Marketplace" strategy.
 * Every release must target a stage strictly later than the one before it
 * (and later than the strategy's own starting stage), and be strictly in
 * the future and strictly increasing in time. Pure — no I/O; the caller
 * resolves "now" and passes it in.
 */
export function assertValidReleaseChain(
  strategy: LoadAudienceStrategyType,
  releases: readonly RequestedRelease[],
  now: Date,
): void {
  if (strategy === LoadAudienceStrategyType.MARKETPLACE) {
    if (releases.length > 0) {
      throw new AudienceValidationError(
        "A Marketplace load is already at its final audience stage — no release schedule applies",
      );
    }
    return;
  }

  const maxReleases = strategy === LoadAudienceStrategyType.NETWORK_FIRST ? 1 : 2;
  if (releases.length > maxReleases) {
    throw new AudienceValidationError("Too many scheduled releases for this strategy");
  }
  const first = releases[0];
  const second = releases[1];
  if (
    strategy === LoadAudienceStrategyType.NETWORK_FIRST &&
    first &&
    first.toStage !== LoadAudienceStage.MARKETPLACE
  ) {
    throw new AudienceValidationError("Network First may only schedule a release to Marketplace");
  }
  if (strategy === LoadAudienceStrategyType.SELECTED_FIRST && first && second) {
    if (first.toStage !== LoadAudienceStage.NETWORK || second.toStage !== LoadAudienceStage.MARKETPLACE) {
      throw new AudienceValidationError(
        "A two-stage release chain must go Selected → Network → Marketplace, in that order",
      );
    }
  }

  let previousOrdinal = strategy === LoadAudienceStrategyType.NETWORK_FIRST ? stageOrdinal(LoadAudienceStage.NETWORK) : stageOrdinal(LoadAudienceStage.SELECTED);
  let previousAt: Date | null = null;
  for (const r of releases) {
    const ord = stageOrdinal(r.toStage);
    if (ord <= previousOrdinal) {
      throw new AudienceValidationError("Release stages must strictly widen the audience");
    }
    if (r.releaseAt.getTime() <= now.getTime()) {
      throw new AudienceValidationError("A scheduled release must be in the future");
    }
    if (previousAt && r.releaseAt.getTime() <= previousAt.getTime()) {
      throw new AudienceValidationError(
        "Each scheduled release must be later than the one before it",
      );
    }
    previousOrdinal = ord;
    previousAt = r.releaseAt;
  }
}
