import { CompanyBlockStatus, LoadStatus } from "@loadtopia/shared";
import { describe, expect, it } from "vitest";
import {
  ACTIVE_FREIGHT_STATUSES,
  initialBlockStatus,
  isActiveFreightStatus,
  isBlockInForce,
} from "./block-state";

describe("isActiveFreightStatus", () => {
  it("treats AWARDED through DELIVERED as active", () => {
    for (const status of ACTIVE_FREIGHT_STATUSES) {
      expect(isActiveFreightStatus(status)).toBe(true);
    }
  });

  it("does not treat pre-award statuses as active freight", () => {
    expect(isActiveFreightStatus(LoadStatus.DRAFT)).toBe(false);
    expect(isActiveFreightStatus(LoadStatus.POSTED)).toBe(false);
    expect(isActiveFreightStatus(LoadStatus.OFFER_RECEIVED)).toBe(false);
  });

  it("does not treat COMPLETED or CANCELLED as active freight", () => {
    expect(isActiveFreightStatus(LoadStatus.COMPLETED)).toBe(false);
    expect(isActiveFreightStatus(LoadStatus.CANCELLED)).toBe(false);
  });
});

describe("initialBlockStatus", () => {
  it("starts PENDING_ON_COMPLETION when active freight exists", () => {
    expect(initialBlockStatus(true)).toBe(CompanyBlockStatus.PENDING_ON_COMPLETION);
  });

  it("starts ACTIVE immediately when no active freight exists", () => {
    expect(initialBlockStatus(false)).toBe(CompanyBlockStatus.ACTIVE);
  });
});

describe("isBlockInForce", () => {
  it("treats ACTIVE and PENDING_ON_COMPLETION as in force", () => {
    expect(isBlockInForce(CompanyBlockStatus.ACTIVE)).toBe(true);
    expect(isBlockInForce(CompanyBlockStatus.PENDING_ON_COMPLETION)).toBe(true);
  });

  it("treats INACTIVE (unblocked) as not in force", () => {
    expect(isBlockInForce(CompanyBlockStatus.INACTIVE)).toBe(false);
  });
});
