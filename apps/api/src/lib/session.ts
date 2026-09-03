import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Opaque session tokens.
 *
 * - The raw token (256 bits, base64url) is sent to the client in an httpOnly
 *   cookie and never stored server-side.
 * - Only the SHA-256 hash of the token is persisted (`sessions.token_hash`), so
 *   a database leak does not expose usable credentials.
 * - Lookups are by hash; revocation is a row update (unlike stateless JWTs).
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionExpiry(ttlHours: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + ttlHours * 3_600_000);
}

export function isSessionActive(
  session: { expiresAt: Date; revokedAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (session.revokedAt !== null) return false;
  return session.expiresAt.getTime() > now.getTime();
}

/** Constant-time compare of two hex digests of equal length. */
export function safeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
