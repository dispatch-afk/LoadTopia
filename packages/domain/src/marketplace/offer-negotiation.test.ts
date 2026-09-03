import { describe, expect, it } from "vitest";
import {
  NegotiationError,
  assertCanRespond,
  canRespondToRound,
  nextRoundNumber,
  partyFor,
  proposingParty,
  respondingParty,
  type RoundContext,
} from "./offer-negotiation";

const carrierProposed: RoundContext = {
  proposedByCompanyId: "co-carrier",
  loadShipperCompanyId: "co-shipper",
  threadCarrierCompanyId: "co-carrier",
};
const shipperProposed: RoundContext = { ...carrierProposed, proposedByCompanyId: "co-shipper" };

describe("negotiation turn-taking", () => {
  it("identifies each company's party", () => {
    expect(partyFor(carrierProposed, "co-carrier")).toBe("CARRIER");
    expect(partyFor(carrierProposed, "co-shipper")).toBe("SHIPPER");
    expect(partyFor(carrierProposed, "co-stranger")).toBeNull();
  });

  it("the responding party is the one who did not propose", () => {
    expect(proposingParty(carrierProposed)).toBe("CARRIER");
    expect(respondingParty(carrierProposed)).toBe("SHIPPER");
    expect(proposingParty(shipperProposed)).toBe("SHIPPER");
    expect(respondingParty(shipperProposed)).toBe("CARRIER");
  });

  it("only the non-proposing party of the thread may respond", () => {
    expect(canRespondToRound(carrierProposed, "co-shipper")).toBe(true);
    expect(canRespondToRound(carrierProposed, "co-carrier")).toBe(false); // proposer waits
    expect(canRespondToRound(carrierProposed, "co-stranger")).toBe(false);

    expect(canRespondToRound(shipperProposed, "co-carrier")).toBe(true);
    expect(canRespondToRound(shipperProposed, "co-shipper")).toBe(false);
  });

  it("assertCanRespond throws 404 for a stranger and 409 for the proposer", () => {
    expect(() => assertCanRespond(carrierProposed, "co-shipper")).not.toThrow();
    try {
      assertCanRespond(carrierProposed, "co-stranger");
      throw new Error("x");
    } catch (e) {
      expect((e as NegotiationError).statusCode).toBe(404);
    }
    try {
      assertCanRespond(carrierProposed, "co-carrier");
      throw new Error("x");
    } catch (e) {
      expect((e as NegotiationError).statusCode).toBe(409);
    }
  });

  it("nextRoundNumber increments", () => {
    expect(nextRoundNumber(0)).toBe(1);
    expect(nextRoundNumber(3)).toBe(4);
  });
});
