/**
 * Server-authoritative offer expiration. M2 uses LAZY expiration — an offer is
 * expired on read/action when its deadline has passed — with a helper that a
 * future background worker (BullMQ/cron) can call directly, so adding the worker
 * later needs no domain change. All times are UTC.
 */

const HOUR_MS = 3_600_000;

export function computeExpiry(from: Date, hours: number): Date {
  return new Date(from.getTime() + hours * HOUR_MS);
}

export function isExpired(expiresAt: Date | string, now: Date = new Date()): boolean {
  const t = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  return Number.isFinite(t) && t <= now.getTime();
}

/**
 * Decide whether an ACTIVE thread should be expired now.
 * @returns true when the thread's current round has passed its deadline.
 */
export function threadShouldExpire(
  thread: { status: "ACTIVE" | "ACCEPTED" | "REJECTED" | "WITHDRAWN" | "EXPIRED" },
  currentRound: { expiresAt: Date | string } | null,
  now: Date = new Date(),
): boolean {
  if (thread.status !== "ACTIVE" || !currentRound) return false;
  return isExpired(currentRound.expiresAt, now);
}
