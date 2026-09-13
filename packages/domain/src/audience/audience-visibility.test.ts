import { LoadAudienceStage } from "@loadtopia/shared";
import { describe, expect, it } from "vitest";
import { isCarrierInAudience } from "./audience-visibility";

describe("isCarrierInAudience", () => {
  it("a block always wins, even on Marketplace stage", () => {
    expect(
      isCarrierInAudience({
        hasStrategyRecord: true,
        currentStage: LoadAudienceStage.MARKETPLACE,
        isCurrentStageMember: true,
        hasAcceptedConnection: true,
        blockInForce: true,
      }),
    ).toBe(false);
  });

  it("a block wins even for a legacy (no strategy record) load", () => {
    expect(
      isCarrierInAudience({
        hasStrategyRecord: false,
        currentStage: null,
        isCurrentStageMember: false,
        hasAcceptedConnection: false,
        blockInForce: true,
      }),
    ).toBe(false);
  });

  it("a legacy pre-Phase-4 load is fully marketplace-visible with no block", () => {
    expect(
      isCarrierInAudience({
        hasStrategyRecord: false,
        currentStage: null,
        isCurrentStageMember: false,
        hasAcceptedConnection: false,
        blockInForce: false,
      }),
    ).toBe(true);
  });

  it("MARKETPLACE stage is visible to any unblocked carrier — no snapshot, no connection required", () => {
    expect(
      isCarrierInAudience({
        hasStrategyRecord: true,
        currentStage: LoadAudienceStage.MARKETPLACE,
        isCurrentStageMember: false,
        hasAcceptedConnection: false,
        blockInForce: false,
      }),
    ).toBe(true);
  });

  describe("NETWORK stage — snapshot membership AND current connection both required", () => {
    it("visible: in the frozen NETWORK snapshot AND currently connected", () => {
      expect(
        isCarrierInAudience({
          hasStrategyRecord: true,
          currentStage: LoadAudienceStage.NETWORK,
          isCurrentStageMember: true,
          hasAcceptedConnection: true,
          blockInForce: false,
        }),
      ).toBe(true);
    });

    it("not visible: in the snapshot but no longer connected (disconnected)", () => {
      expect(
        isCarrierInAudience({
          hasStrategyRecord: true,
          currentStage: LoadAudienceStage.NETWORK,
          isCurrentStageMember: true,
          hasAcceptedConnection: false,
          blockInForce: false,
        }),
      ).toBe(false);
    });

    it("not visible: currently connected but was never in the frozen snapshot (connected after the stage was established)", () => {
      expect(
        isCarrierInAudience({
          hasStrategyRecord: true,
          currentStage: LoadAudienceStage.NETWORK,
          isCurrentStageMember: false,
          hasAcceptedConnection: true,
          blockInForce: false,
        }),
      ).toBe(false);
    });
  });

  describe("SELECTED stage — snapshot membership AND current connection both required", () => {
    it("visible: selected AND currently connected", () => {
      expect(
        isCarrierInAudience({
          hasStrategyRecord: true,
          currentStage: LoadAudienceStage.SELECTED,
          isCurrentStageMember: true,
          hasAcceptedConnection: true,
          blockInForce: false,
        }),
      ).toBe(true);
    });

    it("not visible: selected but currently disconnected — a snapshot alone is history, not authority", () => {
      expect(
        isCarrierInAudience({
          hasStrategyRecord: true,
          currentStage: LoadAudienceStage.SELECTED,
          isCurrentStageMember: true,
          hasAcceptedConnection: false,
          blockInForce: false,
        }),
      ).toBe(false);
    });

    it("not visible: currently connected but never selected — a live connection never substitutes for the frozen snapshot", () => {
      expect(
        isCarrierInAudience({
          hasStrategyRecord: true,
          currentStage: LoadAudienceStage.SELECTED,
          isCurrentStageMember: false,
          hasAcceptedConnection: true,
          blockInForce: false,
        }),
      ).toBe(false);
    });

    it("visible again after reconnect: same unchanged snapshot, connection restored", () => {
      // The snapshot (isCurrentStageMember) never changes across a
      // disconnect/reconnect cycle — only hasAcceptedConnection flips back.
      const snapshotMember = { isCurrentStageMember: true } as const;
      const disconnected = isCarrierInAudience({
        hasStrategyRecord: true,
        currentStage: LoadAudienceStage.SELECTED,
        hasAcceptedConnection: false,
        blockInForce: false,
        ...snapshotMember,
      });
      const reconnected = isCarrierInAudience({
        hasStrategyRecord: true,
        currentStage: LoadAudienceStage.SELECTED,
        hasAcceptedConnection: true,
        blockInForce: false,
        ...snapshotMember,
      });
      expect(disconnected).toBe(false);
      expect(reconnected).toBe(true);
    });
  });
});
