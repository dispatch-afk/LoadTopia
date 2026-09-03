import { deriveLoadNumberPrefix, disambiguatePrefix } from "@loadtopia/domain";

interface PrefixChecker {
  company: { findUnique(args: { where: { loadNumberPrefix: string } }): Promise<unknown> };
}

/**
 * Derive a readable load-number prefix from the company name and make it
 * globally unique by appending a numeric suffix on collision. Runs inside the
 * company-creation transaction.
 */
export async function generateUniqueLoadNumberPrefix(
  tx: PrefixChecker,
  companyName: string,
): Promise<string> {
  const base = deriveLoadNumberPrefix(companyName);
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : disambiguatePrefix(base, attempt);
    const taken = await tx.company.findUnique({ where: { loadNumberPrefix: candidate } });
    if (!taken) return candidate;
  }
  // Extremely unlikely; fall back to a random token.
  return `LT${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}
