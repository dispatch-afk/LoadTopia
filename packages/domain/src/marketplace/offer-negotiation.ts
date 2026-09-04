/**
 * Turn-taking rules for a negotiation. A round is a proposal by one party; only
 * the OTHER party may respond to it (counter / accept / reject-or-withdraw). The
 * initial round is always proposed by the carrier.
 */

export type NegotiationParty = "CARRIER" | "SHIPPER";

export class NegotiationError extends Error {
  readonly code = "NEGOTIATION_RULE";
  readonly statusCode: number;
  constructor(message: string, statusCode = 409) {
    super(message);
    this.name = "NegotiationError";
    this.statusCode = statusCode;
  }
}

export interface RoundContext {
  /** The company that made the current round. */
  proposedByCompanyId: string;
  loadShipperCompanyId: string;
  threadCarrierCompanyId: string;
}

/** Which side of the table a company is on for this thread. */
export function partyFor(ctx: RoundContext, companyId: string): NegotiationParty | null {
  if (companyId === ctx.threadCarrierCompanyId) return "CARRIER";
  if (companyId === ctx.loadShipperCompanyId) return "SHIPPER";
  return null;
}

/** The party who made the current round. */
export function proposingParty(ctx: RoundContext): NegotiationParty {
  return ctx.proposedByCompanyId === ctx.threadCarrierCompanyId ? "CARRIER" : "SHIPPER";
}

/** The party whose turn it is to respond to the current round. */
export function respondingParty(ctx: RoundContext): NegotiationParty {
  return proposingParty(ctx) === "CARRIER" ? "SHIPPER" : "CARRIER";
}

/**
 * May `companyId` counter or accept the current round? Only if they are a party
 * to the thread AND they are not the one who made the current proposal.
 */
export function canRespondToRound(ctx: RoundContext, companyId: string): boolean {
  const party = partyFor(ctx, companyId);
  if (party === null) return false;
  return companyId !== ctx.proposedByCompanyId;
}

export function assertCanRespond(ctx: RoundContext, companyId: string): void {
  const party = partyFor(ctx, companyId);
  if (party === null) {
    throw new NegotiationError("You are not a party to this negotiation", 404);
  }
  if (companyId === ctx.proposedByCompanyId) {
    throw new NegotiationError(
      "You made the current proposal — wait for the other party to respond",
      409,
    );
  }
}

export function nextRoundNumber(currentRoundCount: number): number {
  return currentRoundCount + 1;
}
