import { LOAD_STATUSES, LoadStatus } from "@loadtopia/shared";
import { describe, expect, it } from "vitest";
import {
  LOAD_STATUS_TRANSITIONS,
  LoadTransitionError,
  assertLoadTransition,
  canCancelLoad,
  canTransitionLoad,
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
});
