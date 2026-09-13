import { LoadAudienceStage, LoadAudienceStrategyType } from "@loadtopia/shared";

/**
 * Freight audience strategy (Milestone 4 Phase 4).
 *
 * The audience visibility boundary for a load is a single forward-only
 * pointer, `LoadAudienceStrategyRecord.currentStage`, ordered
 * SELECTED < NETWORK < MARKETPLACE. Widening the audience always means
 * advancing this same pointer on the SAME load — never cloning it, never
 * creating a second load, never moving it backward.
 */
export const STAGE_ORDER: readonly LoadAudienceStage[] = [
  LoadAudienceStage.SELECTED,
  LoadAudienceStage.NETWORK,
  LoadAudienceStage.MARKETPLACE,
];

export function stageOrdinal(stage: LoadAudienceStage): number {
  return STAGE_ORDER.indexOf(stage);
}

/** True when `to` is strictly further along than `from` — the only direction
 *  a load's audience is ever allowed to move. */
export function isForwardStage(from: LoadAudienceStage, to: LoadAudienceStage): boolean {
  return stageOrdinal(to) > stageOrdinal(from);
}

/** True when `to` is the IMMEDIATE next stage after `from` — the guard the
 *  automatic release chain uses so a scheduled release can never skip a
 *  stage out of order (a manual "Release Now" may skip stages; a scheduled
 *  one-hop release may not). */
export function isImmediateNextStage(from: LoadAudienceStage, to: LoadAudienceStage): boolean {
  return stageOrdinal(to) === stageOrdinal(from) + 1;
}

/** The stage a load starts at for a given strategy, at Review & Post. */
export function initialStageFor(strategy: LoadAudienceStrategyType): LoadAudienceStage {
  switch (strategy) {
    case LoadAudienceStrategyType.SELECTED_FIRST:
      return LoadAudienceStage.SELECTED;
    case LoadAudienceStrategyType.NETWORK_FIRST:
      return LoadAudienceStage.NETWORK;
    case LoadAudienceStrategyType.MARKETPLACE:
      return LoadAudienceStage.MARKETPLACE;
  }
}

/** The stages a strategy may ever legally pass through, in order — used to
 *  validate a shipper's requested release chain at Review & Post. */
export function legalStageSequenceFor(
  strategy: LoadAudienceStrategyType,
): readonly LoadAudienceStage[] {
  switch (strategy) {
    case LoadAudienceStrategyType.SELECTED_FIRST:
      return STAGE_ORDER; // SELECTED -> NETWORK -> MARKETPLACE
    case LoadAudienceStrategyType.NETWORK_FIRST:
      return [LoadAudienceStage.NETWORK, LoadAudienceStage.MARKETPLACE];
    case LoadAudienceStrategyType.MARKETPLACE:
      return [LoadAudienceStage.MARKETPLACE];
  }
}
