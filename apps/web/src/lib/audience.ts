import type {
  LoadAudienceStage,
  LoadAudienceStrategyType,
  LoadListAudienceSummary,
} from "@loadtopia/shared";
import { fmtExactDateTime } from "./format";

export const AUDIENCE_STRATEGY_LABEL: Record<LoadAudienceStrategyType, string> = {
  MARKETPLACE: "Marketplace",
  NETWORK_FIRST: "My Carrier Network first",
  SELECTED_FIRST: "Selected carriers first",
};

export const AUDIENCE_STAGE_LABEL: Record<LoadAudienceStage, string> = {
  SELECTED: "Selected carriers",
  NETWORK: "Carrier Network",
  MARKETPLACE: "Marketplace",
};

/** Useful, non-exhaustive presets — the shipper may always enter a custom
 *  time instead (see the release-timing picker). */
export const RELEASE_PRESET_HOURS = [1, 2, 4, 8, 12, 24] as const;

export function presetReleaseAt(hours: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + hours * 3_600_000);
}

/** A short, factual description of what the shipper will see for a load's
 *  current audience — used on the shipper Loads list. Never a phantom
 *  signal, never a count that wasn't actually fetched. */
export function audienceSummaryText(audience: LoadListAudienceSummary | null): string {
  if (!audience) return "Marketplace";
  return AUDIENCE_STAGE_LABEL[audience.currentStage];
}

export function nextReleaseText(nextReleaseAt: string | null): string {
  if (!nextReleaseAt) return "No automatic release scheduled";
  return fmtExactDateTime(nextReleaseAt);
}

const TIMING_WARNING_THRESHOLD_MINUTES = 4 * 60;

/** Minutes between a scheduled release and the pickup window start, or null
 *  when there's nothing reliable to compare against, or the margin is
 *  comfortable enough not to warrant a warning. */
export function computeTimingWarningMinutes(
  releaseAt: Date,
  pickupWindowStart: string | null,
): number | null {
  if (!pickupWindowStart) return null;
  const minutes = Math.round((new Date(pickupWindowStart).getTime() - releaseAt.getTime()) / 60_000);
  return minutes < TIMING_WARNING_THRESHOLD_MINUTES ? minutes : null;
}

function describeDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/** Factual, non-blocking phrasing for a release scheduled close to pickup —
 *  never predicts failure, never says the load "may be late" (spec §20). */
export function timingWarningText(minutesBeforePickup: number): string {
  if (minutesBeforePickup < 0) {
    return `This release is scheduled ${describeDuration(Math.abs(minutesBeforePickup))} after the pickup window begins.`;
  }
  return `This release is scheduled ${describeDuration(minutesBeforePickup)} before the pickup window begins.`;
}
