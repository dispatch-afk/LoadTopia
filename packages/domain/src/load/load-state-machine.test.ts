import { LOAD_STATUSES, LoadStatus } from "@loadtopia/shared";
import { describe, expect, it } from "vitest";
import {
  EXPOSED_LOAD_STATUSES,
  LOAD_STATUS_TRANSITIONS,
  LoadTransitionError,
  assertLoadTransition,
  canCancelLoad,
  canTransitionLoad,
  isExposedLoadStatus,
  isTerminalLoadStatus,
  nextLoadStatuses,
} from "./load-state-machine";

describe("load state machine", () => {
  it("defines transitions for every status exactly once", () => {
    for (const status of LOAD_STATUSES) {
      expect(LOAD_STATUS_TRANSITIONS).toHaveProperty(status);
    }
    expect(Object.keys(LOAD_STATUS_TRANSITIONS).sort()).toEqual([...LOAD_STATUSES].sort());
  });

  it("allows the documented happy path end to end", () => {
    const path: LoadStatus[] = [
      LoadStatus.DRAFT,
      LoadStatus.POSTED,
      LoadStatus.OFFER_RECEIVED,
      LoadStatus.AWARDED,
      LoadStatus.CARRIER_ASSIGNED,
      LoadStatus.PICKED_UP,
      LoadStatus.IN_TRANSIT,
      LoadStatus.DELIVERED,
      LoadStatus.COMPLETED,
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransitionLoad(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it("rejects skipping a lifecycle step", () => {
    expect(canTransitionLoad(LoadStatus.DRAFT, LoadStatus.AWARDED)).toBe(false);
    expect(canTransitionLoad(LoadStatus.POSTED, LoadStatus.PICKED_UP)).toBe(false);
    expect(canTransitionLoad(LoadStatus.IN_TRANSIT, LoadStatus.COMPLETED)).toBe(false);
  });

  it("throws LoadTransitionError from assertLoadTransition on an illegal move", () => {
    expect(() => assertLoadTransition(LoadStatus.DELIVERED, LoadStatus.DRAFT)).toThrow(
      LoadTransitionError,
    );
    expect(() => assertLoadTransition(LoadStatus.POSTED, LoadStatus.OFFER_RECEIVED)).not.toThrow();
  });

  it("treats COMPLETED and CANCELLED as terminal with no exits", () => {
    expect(isTerminalLoadStatus(LoadStatus.COMPLETED)).toBe(true);
    expect(isTerminalLoadStatus(LoadStatus.CANCELLED)).toBe(true);
    expect(nextLoadStatuses(LoadStatus.COMPLETED)).toHaveLength(0);
    expect(nextLoadStatuses(LoadStatus.CANCELLED)).toHaveLength(0);
  });

  it("permits controlled cancellation only before the freight is in motion", () => {
    expect(canCancelLoad(LoadStatus.DRAFT)).toBe(true);
    expect(canCancelLoad(LoadStatus.POSTED)).toBe(true);
    expect(canCancelLoad(LoadStatus.CARRIER_ASSIGNED)).toBe(true);
    expect(canCancelLoad(LoadStatus.PICKED_UP)).toBe(false);
    expect(canCancelLoad(LoadStatus.IN_TRANSIT)).toBe(false);
    expect(canCancelLoad(LoadStatus.DELIVERED)).toBe(false);
  });

  it("never lists a status as its own successor", () => {
    for (const status of LOAD_STATUSES) {
      expect(nextLoadStatuses(status)).not.toContain(status);
    }
  });

  it("supports the Milestone 1 shipper-side transitions", () => {
    // DRAFT -> POSTED -> DRAFT (withdraw to edit) -> POSTED, and cancel from either.
    expect(canTransitionLoad(LoadStatus.DRAFT, LoadStatus.POSTED)).toBe(true);
    expect(canTransitionLoad(LoadStatus.POSTED, LoadStatus.DRAFT)).toBe(true);
    expect(canTransitionLoad(LoadStatus.DRAFT, LoadStatus.CANCELLED)).toBe(true);
    expect(canTransitionLoad(LoadStatus.POSTED, LoadStatus.CANCELLED)).toBe(true);
  });

  it("still refuses a client-style jump straight to a completed/delivered state", () => {
    expect(canTransitionLoad(LoadStatus.DRAFT, LoadStatus.COMPLETED)).toBe(false);
    expect(canTransitionLoad(LoadStatus.DRAFT, LoadStatus.DELIVERED)).toBe(false);
    expect(canTransitionLoad(LoadStatus.POSTED, LoadStatus.COMPLETED)).toBe(false);
  });

  it("supports the Milestone 2 marketplace progression", () => {
    expect(canTransitionLoad(LoadStatus.POSTED, LoadStatus.OFFER_RECEIVED)).toBe(true);
    expect(canTransitionLoad(LoadStatus.OFFER_RECEIVED, LoadStatus.AWARDED)).toBe(true);
    expect(canTransitionLoad(LoadStatus.POSTED, LoadStatus.AWARDED)).toBe(true);
    expect(canTransitionLoad(LoadStatus.AWARDED, LoadStatus.CARRIER_ASSIGNED)).toBe(true);
    // Controlled cancellation still reachable through the marketplace states.
    expect(canCancelLoad(LoadStatus.OFFER_RECEIVED)).toBe(true);
    expect(canCancelLoad(LoadStatus.AWARDED)).toBe(true);
    expect(canCancelLoad(LoadStatus.CARRIER_ASSIGNED)).toBe(true);
  });

  it("exposes only DRAFT..CARRIER_ASSIGNED + CANCELLED (no execution states yet)", () => {
    expect([...EXPOSED_LOAD_STATUSES].sort()).toEqual(
      ["DRAFT", "POSTED", "OFFER_RECEIVED", "AWARDED", "CARRIER_ASSIGNED", "CANCELLED"].sort(),
    );
    expect(isExposedLoadStatus(LoadStatus.PICKED_UP)).toBe(false);
    expect(isExposedLoadStatus(LoadStatus.DELIVERED)).toBe(false);
    expect(isExposedLoadStatus(LoadStatus.COMPLETED)).toBe(false);
    expect(isExposedLoadStatus(LoadStatus.AWARDED)).toBe(true);
  });
});
