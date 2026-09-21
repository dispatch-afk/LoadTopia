import { LoadAudienceStage, LoadAudienceStrategyType } from "@loadtopia/shared";
import { describe, expect, it } from "vitest";
import { assertValidReleaseChain } from "./release-validation";

const NOW = new Date("2026-09-13T00:00:00.000Z");
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

describe("assertValidReleaseChain", () => {
  it("Marketplace strategy accepts no releases", () => {
    expect(() =>
      assertValidReleaseChain(LoadAudienceStrategyType.MARKETPLACE, [], NOW),
    ).not.toThrow();
  });

  it("Marketplace strategy rejects any release", () => {
    expect(() =>
      assertValidReleaseChain(
        LoadAudienceStrategyType.MARKETPLACE,
        [{ toStage: LoadAudienceStage.MARKETPLACE, releaseAt: hoursFromNow(1) }],
        NOW,
      ),
    ).toThrow(/already at its final/i);
  });

  it("Network First accepts zero or one release, always to Marketplace", () => {
    expect(() =>
      assertValidReleaseChain(LoadAudienceStrategyType.NETWORK_FIRST, [], NOW),
    ).not.toThrow();
    expect(() =>
      assertValidReleaseChain(
        LoadAudienceStrategyType.NETWORK_FIRST,
        [{ toStage: LoadAudienceStage.MARKETPLACE, releaseAt: hoursFromNow(4) }],
        NOW,
      ),
    ).not.toThrow();
  });

  it("Network First rejects a release targeting Network (it already starts there)", () => {
    expect(() =>
      assertValidReleaseChain(
        LoadAudienceStrategyType.NETWORK_FIRST,
        [{ toStage: LoadAudienceStage.NETWORK, releaseAt: hoursFromNow(4) }],
        NOW,
      ),
    ).toThrow();
  });

  it("Selected First accepts a single release straight to Marketplace", () => {
    expect(() =>
      assertValidReleaseChain(
        LoadAudienceStrategyType.SELECTED_FIRST,
        [{ toStage: LoadAudienceStage.MARKETPLACE, releaseAt: hoursFromNow(2) }],
        NOW,
      ),
    ).not.toThrow();
  });

  it("Selected First accepts a single release to Network only", () => {
    expect(() =>
      assertValidReleaseChain(
        LoadAudienceStrategyType.SELECTED_FIRST,
        [{ toStage: LoadAudienceStage.NETWORK, releaseAt: hoursFromNow(2) }],
        NOW,
      ),
    ).not.toThrow();
  });

  it("Selected First accepts a chained Network-then-Marketplace release", () => {
    expect(() =>
      assertValidReleaseChain(
        LoadAudienceStrategyType.SELECTED_FIRST,
        [
          { toStage: LoadAudienceStage.NETWORK, releaseAt: hoursFromNow(2) },
          { toStage: LoadAudienceStage.MARKETPLACE, releaseAt: hoursFromNow(8) },
        ],
        NOW,
      ),
    ).not.toThrow();
  });

  it("Selected First rejects a Marketplace-then-Network chain (out of order)", () => {
    expect(() =>
      assertValidReleaseChain(
        LoadAudienceStrategyType.SELECTED_FIRST,
        [
          { toStage: LoadAudienceStage.MARKETPLACE, releaseAt: hoursFromNow(2) },
          { toStage: LoadAudienceStage.NETWORK, releaseAt: hoursFromNow(8) },
        ],
        NOW,
      ),
    ).toThrow(/in that order/i);
  });

  it("rejects a release scheduled in the past", () => {
    expect(() =>
      assertValidReleaseChain(
        LoadAudienceStrategyType.NETWORK_FIRST,
        [{ toStage: LoadAudienceStage.MARKETPLACE, releaseAt: hoursFromNow(-1) }],
        NOW,
      ),
    ).toThrow(/future/i);
  });

  it("rejects a chain whose second release is not later than the first", () => {
    expect(() =>
      assertValidReleaseChain(
        LoadAudienceStrategyType.SELECTED_FIRST,
        [
          { toStage: LoadAudienceStage.NETWORK, releaseAt: hoursFromNow(8) },
          { toStage: LoadAudienceStage.MARKETPLACE, releaseAt: hoursFromNow(2) },
        ],
        NOW,
      ),
    ).toThrow(/later than the one before/i);
  });

  it("rejects more releases than the strategy allows", () => {
    expect(() =>
      assertValidReleaseChain(
        LoadAudienceStrategyType.NETWORK_FIRST,
        [
          { toStage: LoadAudienceStage.MARKETPLACE, releaseAt: hoursFromNow(2) },
          { toStage: LoadAudienceStage.MARKETPLACE, releaseAt: hoursFromNow(4) },
        ],
        NOW,
      ),
    ).toThrow(/too many/i);
  });
});
