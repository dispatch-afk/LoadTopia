import { describe, expect, it } from "vitest";
import {
  CompanyContextError,
  defaultActiveCompanyId,
  resolveActiveCompany,
  type MembershipRef,
} from "./active-company";

const m = (companyId: string, over: Partial<MembershipRef> = {}): MembershipRef => ({
  companyId,
  isActive: true,
  isPrimary: false,
  createdAt: "2026-01-01T00:00:00Z",
  ...over,
});

describe("defaultActiveCompanyId", () => {
  it("prefers the primary active membership", () => {
    expect(
      defaultActiveCompanyId([m("a"), m("b", { isPrimary: true }), m("c")]),
    ).toBe("b");
  });

  it("falls back to the oldest active membership when none is primary", () => {
    expect(
      defaultActiveCompanyId([
        m("new", { createdAt: "2026-06-01T00:00:00Z" }),
        m("old", { createdAt: "2026-01-01T00:00:00Z" }),
      ]),
    ).toBe("old");
  });

  it("ignores inactive memberships", () => {
    expect(defaultActiveCompanyId([m("x", { isActive: false }), m("y")])).toBe("y");
    expect(defaultActiveCompanyId([m("x", { isActive: false })])).toBeNull();
  });

  it("returns null for a user with no memberships (staff account)", () => {
    expect(defaultActiveCompanyId([])).toBeNull();
  });
});

describe("resolveActiveCompany", () => {
  const memberships = [m("a", { isPrimary: true }), m("b"), m("gone", { isActive: false })];

  it("honours an explicit switch to a company the user actively belongs to", () => {
    expect(resolveActiveCompany(memberships, "a", "b")).toBe("b");
  });

  it("rejects an explicit switch to a non-member company with 404", () => {
    try {
      resolveActiveCompany(memberships, "a", "someone-elses-company");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CompanyContextError);
      expect((err as CompanyContextError).statusCode).toBe(404);
    }
  });

  it("rejects an explicit switch to a now-inactive membership", () => {
    expect(() => resolveActiveCompany(memberships, "a", "gone")).toThrow(CompanyContextError);
  });

  it("keeps the session's company when it is still an active membership", () => {
    expect(resolveActiveCompany(memberships, "b")).toBe("b");
  });

  it("re-defaults when the session points at a company the user left", () => {
    expect(resolveActiveCompany(memberships, "gone")).toBe("a");
  });

  it("defaults on first use when the session has no company", () => {
    expect(resolveActiveCompany(memberships, null)).toBe("a");
  });

  it("returns null for a staff account with no memberships", () => {
    expect(resolveActiveCompany([], null)).toBeNull();
  });
});
