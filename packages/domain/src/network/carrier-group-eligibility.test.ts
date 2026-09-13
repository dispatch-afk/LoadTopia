import { CompanyBlockStatus, ConnectionStatus } from "@loadtopia/shared";
import { describe, expect, it } from "vitest";
import { canAddCarrierToGroup } from "./carrier-group-eligibility";

describe("canAddCarrierToGroup", () => {
  it("is eligible with an ACCEPTED connection and no block", () => {
    expect(
      canAddCarrierToGroup({ connectionStatus: ConnectionStatus.ACCEPTED, blockStatus: null }),
    ).toEqual({ eligible: true });
  });

  it("rejects when there is no ACCEPTED connection", () => {
    expect(
      canAddCarrierToGroup({ connectionStatus: null, blockStatus: null }),
    ).toEqual({ eligible: false, reason: "NOT_CONNECTED" });
    expect(
      canAddCarrierToGroup({ connectionStatus: ConnectionStatus.PENDING, blockStatus: null }),
    ).toEqual({ eligible: false, reason: "NOT_CONNECTED" });
    expect(
      canAddCarrierToGroup({ connectionStatus: ConnectionStatus.DECLINED, blockStatus: null }),
    ).toEqual({ eligible: false, reason: "NOT_CONNECTED" });
  });

  it("rejects when a block is in force, even with an ACCEPTED connection", () => {
    expect(
      canAddCarrierToGroup({
        connectionStatus: ConnectionStatus.ACCEPTED,
        blockStatus: CompanyBlockStatus.ACTIVE,
      }),
    ).toEqual({ eligible: false, reason: "BLOCKED" });
    expect(
      canAddCarrierToGroup({
        connectionStatus: ConnectionStatus.ACCEPTED,
        blockStatus: CompanyBlockStatus.PENDING_ON_COMPLETION,
      }),
    ).toEqual({ eligible: false, reason: "BLOCKED" });
  });

  it("an INACTIVE (unblocked) historical block does not block eligibility", () => {
    expect(
      canAddCarrierToGroup({
        connectionStatus: ConnectionStatus.ACCEPTED,
        blockStatus: CompanyBlockStatus.INACTIVE,
      }),
    ).toEqual({ eligible: true });
  });

  it("checks block before connection when both would fail", () => {
    expect(
      canAddCarrierToGroup({ connectionStatus: null, blockStatus: CompanyBlockStatus.ACTIVE }),
    ).toEqual({ eligible: false, reason: "BLOCKED" });
  });
});
