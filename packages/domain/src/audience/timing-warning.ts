/**
 * A factual, non-blocking warning when a scheduled release lands close to the
 * pickup window. Never predicts failure, never blocks posting — see
 * Load Audience spec §20. Pure — the caller resolves the pickup window start
 * and passes it in; if the load has no pickup window yet, there is nothing
 * reliable to warn about and this returns null.
 */
export interface TimingWarning {
  /** Minutes between the scheduled release and the pickup window start.
   *  Negative means the release is scheduled AFTER pickup begins. */
  minutesBeforePickup: number;
}

/** Below this margin, a factual warning is surfaced (not a hard rule the
 *  product enforces — just a number worth being deliberate about). */
export const TIMING_WARNING_THRESHOLD_MINUTES = 4 * 60;

export function computeTimingWarning(
  releaseAt: Date,
  pickupWindowStart: Date | null,
): TimingWarning | null {
  if (pickupWindowStart == null) return null;
  const minutesBeforePickup = Math.round(
    (pickupWindowStart.getTime() - releaseAt.getTime()) / 60_000,
  );
  if (minutesBeforePickup >= TIMING_WARNING_THRESHOLD_MINUTES) return null;
  return { minutesBeforePickup };
}
