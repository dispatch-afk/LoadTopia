/**
 * Rate-per-mile display arithmetic (Milestone 4 Phase 5) — a plain division
 * of the shipper's own published USD rate by the load's own routed distance.
 * NEVER a market signal, estimate, or recommendation: no "good"/"bad"/
 * "competitive" label is ever attached to this value anywhere it is
 * rendered — see §8 of the Phase 5 spec ("no phantom intelligence").
 *
 * Returns null whenever either input is missing, or miles is not a positive
 * number (RPM is undefined at zero/unknown distance) — never a fabricated
 * placeholder value.
 */
export function computeRatePerMile(
  postedRate: string | number | null,
  miles: number | null,
): string | null {
  if (postedRate == null || miles == null || miles <= 0) return null;
  const rate = typeof postedRate === "string" ? Number(postedRate) : postedRate;
  if (!Number.isFinite(rate)) return null;
  return (rate / miles).toFixed(2);
}
