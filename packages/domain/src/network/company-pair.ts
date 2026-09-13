import { NetworkError } from "./errors";

export interface CanonicalCompanyPair {
  companyAId: string;
  companyBId: string;
}

/**
 * Canonicalize an unordered pair of company ids into a deterministic
 * (companyAId, companyBId) order so a Connection between two companies is
 * representable as EXACTLY ONE row regardless of which company initiated it
 * — the database-level backstop against a duplicate reverse-direction row.
 *
 * Ordering is a plain string comparison on the UUID's standard lowercase,
 * hyphenated text form. This is deliberately the SAME comparison Postgres
 * performs on its native `uuid` column type (byte-order, which agrees with
 * lexicographic hex-string order for two equal-length, same-case, same-
 * hyphen-position strings) — so the migration's
 * `CHECK (company_a_id < company_b_id)` constraint agrees with this function
 * by construction, not by coincidence. Both sides must independently arrive
 * at the same order for the same pair, every time.
 */
export function canonicalizeCompanyPair(companyId1: string, companyId2: string): CanonicalCompanyPair {
  if (companyId1 === companyId2) {
    throw new NetworkError("A company cannot form a relationship with itself", 400);
  }
  return companyId1 < companyId2
    ? { companyAId: companyId1, companyBId: companyId2 }
    : { companyAId: companyId2, companyBId: companyId1 };
}

/** Given a canonical pair and one of its two companies, return the other. */
export function otherCompanyInPair(pair: CanonicalCompanyPair, companyId: string): string {
  if (companyId === pair.companyAId) return pair.companyBId;
  if (companyId === pair.companyBId) return pair.companyAId;
  throw new NetworkError("Company is not part of this pair", 400);
}
