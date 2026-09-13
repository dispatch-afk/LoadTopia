import { LoadAudienceStage, LoadAudienceStrategyType } from "@loadtopia/shared";
import { describe, expect, it } from "vitest";
import {
  initialStageFor,
  isForwardStage,
  isImmediateNextStage,
  legalStageSequenceFor,
  stageOrdinal,
} from "./stage";

describe("stage ordering", () => {
  it("orders SELECTED < NETWORK < MARKETPLACE", () => {
    expect(stageOrdinal(LoadAudienceStage.SELECTED)).toBeLessThan(
      stageOrdinal(LoadAudienceStage.NETWORK),
    );
    expect(stageOrdinal(LoadAudienceStage.NETWORK)).toBeLessThan(
      stageOrdinal(LoadAudienceStage.MARKETPLACE),
    );
  });

  it("isForwardStage rejects sideways and backward moves", () => {
    expect(isForwardStage(LoadAudienceStage.SELECTED, LoadAudienceStage.MARKETPLACE)).toBe(true);
    expect(isForwardStage(LoadAudienceStage.NETWORK, LoadAudienceStage.SELECTED)).toBe(false);
    expect(isForwardStage(LoadAudienceStage.NETWORK, LoadAudienceStage.NETWORK)).toBe(false);
  });

  it("isImmediateNextStage only accepts a single hop forward", () => {
    expect(isImmediateNextStage(LoadAudienceStage.SELECTED, LoadAudienceStage.NETWORK)).toBe(true);
    expect(isImmediateNextStage(LoadAudienceStage.SELECTED, LoadAudienceStage.MARKETPLACE)).toBe(
      false,
    );
  });

  it("initialStageFor matches each strategy's starting point", () => {
    expect(initialStageFor(LoadAudienceStrategyType.MARKETPLACE)).toBe(
      LoadAudienceStage.MARKETPLACE,
    );
    expect(initialStageFor(LoadAudienceStrategyType.NETWORK_FIRST)).toBe(
      LoadAudienceStage.NETWORK,
    );
    expect(initialStageFor(LoadAudienceStrategyType.SELECTED_FIRST)).toBe(
      LoadAudienceStage.SELECTED,
    );
  });

  it("legalStageSequenceFor is strategy-specific", () => {
    expect(legalStageSequenceFor(LoadAudienceStrategyType.MARKETPLACE)).toEqual([
      LoadAudienceStage.MARKETPLACE,
    ]);
    expect(legalStageSequenceFor(LoadAudienceStrategyType.SELECTED_FIRST)).toEqual([
      LoadAudienceStage.SELECTED,
      LoadAudienceStage.NETWORK,
      LoadAudienceStage.MARKETPLACE,
    ]);
  });
});
