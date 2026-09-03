/**
 * Human-readable, per-company load numbering.
 *
 * A load number is `{prefix}-{sequence}` where:
 *  - `prefix` is a company-unique 2–8 char uppercase token derived from the
 *    company name (globally unique — enforced by a DB unique index), and
 *  - `sequence` is a per-company monotonic counter incremented inside the
 *    create-load transaction.
 *
 * Because the prefix is globally unique and the sequence is unique within the
 * company, `{prefix}-{sequence}` is globally unique with no retry loop.
 */

const PREFIX_MIN = 2;
const PREFIX_MAX = 8;
const SEQUENCE_PAD = 5;

/** Best-effort readable prefix from a company name (caller must dedupe). */
export function deriveLoadNumberPrefix(companyName: string): string {
  const cleaned = companyName
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[^A-Z0-9 ]/g, "")
    .trim();

  const words = cleaned.split(/\s+/).filter(Boolean);
  let candidate: string;
  if (words.length >= 2) {
    // Initials of the first few words, e.g. "Blue Ridge Carriers" -> "BRC".
    candidate = words
      .slice(0, PREFIX_MAX)
      .map((w) => w[0])
      .join("");
  } else {
    candidate = (words[0] ?? "").slice(0, PREFIX_MAX);
  }

  candidate = candidate.replace(/[^A-Z0-9]/g, "");
  if (candidate.length < PREFIX_MIN) {
    candidate = (candidate + "LOAD").slice(0, Math.max(PREFIX_MIN, candidate.length + 1));
  }
  return candidate.slice(0, PREFIX_MAX);
}

/** Append a numeric suffix to disambiguate a taken prefix (e.g. "BRC" -> "BRC2"). */
export function disambiguatePrefix(base: string, attempt: number): string {
  const suffix = String(attempt + 1);
  return (base.slice(0, PREFIX_MAX - suffix.length) + suffix).toUpperCase();
}

export function formatLoadNumber(prefix: string, sequence: number): string {
  if (!/^[A-Z0-9]{2,8}$/.test(prefix)) {
    throw new Error(`invalid load-number prefix: ${prefix}`);
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`invalid load-number sequence: ${sequence}`);
  }
  return `${prefix}-${String(sequence).padStart(SEQUENCE_PAD, "0")}`;
}
