import { LoadStatus } from "@loadtopia/shared";
import { describe, expect, it } from "vitest";
import { AwardError, type AwardCheckInput, assertAwardable } from "./load-award";

const NOW = new Date("2026-09-10T12:00:00Z");

const base: AwardCheckInput = {
  load: { status: LoadStatus.OFFER_RECEIVED },
  thread: { status: "ACTIVE" },
  currentRound: { id: "round-3", expiresAt: new Date("2026-09-12T00:00:00Z") },
  acceptedRoundId: "round-3",
  carrierEligibleNow: true,
  now: NOW,
};

function expectAwardError(input: AwardCheckInput, code: string) {
  try {
    assertAwardable(input);
    throw new Error("should have thrown");
  } catch (err) {
    expect(err).toBeInstanceOf(AwardError);
    expect((err as AwardError).code).toBe(code);
    expect((err as AwardError).statusCode).toBe(409);
  }
}

describe("assertAwardable", () => {
  it("passes for a live, current, unexpired offer on an awardable load", () => {
    expect(() => assertAwardable(base)).not.toThrow();
    expect(() => assertAwardable({ ...base, load: { status: LoadStatus.POSTED } })).not.toThrow();
  });

  it("rejects an already-awarded / assigned load", () => {
    expectAwardError({ ...base, load: { status: LoadStatus.AWARDED } }, "LOAD_ALREADY_AWARDED");
    expectAwardError({ ...base, load: { status: LoadStatus.CARRIER_ASSIGNED } }, "LOAD_ALREADY_AWARDED");
  });

  it("rejects a cancelled / non-awardable load", () => {
    expectAwardError({ ...base, load: { status: LoadStatus.CANCELLED } }, "LOAD_NOT_AWARDABLE");
    expectAwardError({ ...base, load: { status: LoadStatus.DRAFT } }, "LOAD_NOT_AWARDABLE");
  });

  it("rejects a non-active thread (already rejected / withdrawn / accepted / expired)", () => {
    for (const s of ["ACCEPTED", "REJECTED", "WITHDRAWN", "EXPIRED"] as const) {
      expectAwardError({ ...base, thread: { status: s } }, "OFFER_NOT_ACTIVE");
    }
  });

  it("rejects a stale round (negotiation moved on)", () => {
    expectAwardError({ ...base, acceptedRoundId: "round-2" }, "STALE_ROUND");
  });

  it("rejects an expired current round", () => {
    expectAwardError(
      { ...base, currentRound: { id: "round-3", expiresAt: new Date("2026-09-10T11:00:00Z") } },
      "OFFER_EXPIRED",
    );
  });

  it("rejects when the carrier is no longer eligible", () => {
    expectAwardError({ ...base, carrierEligibleNow: false }, "CARRIER_NOT_ELIGIBLE");
  });
});
