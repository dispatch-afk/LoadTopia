import { OFFER_THREAD_STATUSES, OfferThreadStatus } from "@loadtopia/shared";
import { describe, expect, it } from "vitest";
import {
  OFFER_THREAD_TRANSITIONS,
  OfferTransitionError,
  assertThreadTransition,
  canThreadTransition,
  isThreadActive,
  isThreadTerminal,
} from "./offer-state-machine";

describe("offer thread state machine", () => {
  it("defines transitions for every status", () => {
    expect(Object.keys(OFFER_THREAD_TRANSITIONS).sort()).toEqual([...OFFER_THREAD_STATUSES].sort());
  });

  it("only ACTIVE is non-terminal", () => {
    expect(isThreadActive(OfferThreadStatus.ACTIVE)).toBe(true);
    expect(isThreadTerminal(OfferThreadStatus.ACTIVE)).toBe(false);
    for (const s of [
      OfferThreadStatus.ACCEPTED,
      OfferThreadStatus.REJECTED,
      OfferThreadStatus.WITHDRAWN,
      OfferThreadStatus.EXPIRED,
    ]) {
      expect(isThreadTerminal(s)).toBe(true);
      expect(isThreadActive(s)).toBe(false);
    }
  });

  it("allows ACTIVE → any terminal state", () => {
    for (const s of [
      OfferThreadStatus.ACCEPTED,
      OfferThreadStatus.REJECTED,
      OfferThreadStatus.WITHDRAWN,
      OfferThreadStatus.EXPIRED,
    ]) {
      expect(canThreadTransition(OfferThreadStatus.ACTIVE, s)).toBe(true);
    }
  });

  it("rejects any move out of a terminal state (no resurrection)", () => {
    expect(canThreadTransition(OfferThreadStatus.ACCEPTED, OfferThreadStatus.ACTIVE)).toBe(false);
    expect(canThreadTransition(OfferThreadStatus.REJECTED, OfferThreadStatus.ACCEPTED)).toBe(false);
    expect(canThreadTransition(OfferThreadStatus.EXPIRED, OfferThreadStatus.ACCEPTED)).toBe(false);
    expect(() => assertThreadTransition(OfferThreadStatus.WITHDRAWN, OfferThreadStatus.ACCEPTED)).toThrow(
      OfferTransitionError,
    );
  });

  it("assertThreadTransition carries a 409 status code", () => {
    try {
      assertThreadTransition(OfferThreadStatus.EXPIRED, OfferThreadStatus.ACCEPTED);
      throw new Error("should throw");
    } catch (err) {
      expect((err as OfferTransitionError).statusCode).toBe(409);
    }
  });
});
