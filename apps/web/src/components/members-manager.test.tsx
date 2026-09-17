// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MembersManager } from "./members-manager";
import { buildCompanyMemberView } from "@/test/fixtures";

import type * as ApiClientModule from "@/lib/api-client";

const apiClient = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiClient: (...args: unknown[]) => apiClient(...args) };
});

describe("MembersManager — Milestone 4 Phase 11 freight access", () => {
  beforeEach(() => {
    apiClient.mockReset();
  });

  const me = buildCompanyMemberView({
    membershipId: "membership-me",
    userId: "user-me",
    firstName: "Sam",
    lastName: "Primary",
    isPrimary: true,
    freightAccess: { companyWide: true, facilityCount: 0 },
  });
  const teammate = buildCompanyMemberView({
    membershipId: "membership-teammate",
    userId: "user-teammate",
    firstName: "Riley",
    lastName: "Teammate",
    isPrimary: false,
    freightAccess: { companyWide: false, facilityCount: 3 },
  });

  it("shows Company-wide / N assigned facilities per member", () => {
    render(
      <MembersManager
        companyId="company-1"
        initial={[me, teammate]}
        currentUserId="user-me"
        canManage
        canManageFacilityScope
      />,
    );
    expect(screen.getByText("Company-wide")).toBeInTheDocument();
    expect(screen.getByText("3 assigned facilities")).toBeInTheDocument();
  });

  it("never offers Manage access for the viewer's own row, even with authority", () => {
    render(
      <MembersManager
        companyId="company-1"
        initial={[me, teammate]}
        currentUserId="user-me"
        canManage
        canManageFacilityScope
      />,
    );
    // Exactly one "Manage access" button — for the teammate, never for self.
    expect(screen.getAllByRole("button", { name: "Manage access" })).toHaveLength(1);
  });

  it("offers Manage access for another active member when the viewer holds company-primary authority", () => {
    render(
      <MembersManager
        companyId="company-1"
        initial={[me, teammate]}
        currentUserId="user-me"
        canManage
        canManageFacilityScope
      />,
    );
    expect(screen.getByRole("button", { name: "Manage access" })).toBeInTheDocument();
  });

  it("hides Manage access entirely for a viewer without company-primary authority", () => {
    render(
      <MembersManager
        companyId="company-1"
        initial={[me, teammate]}
        currentUserId="user-me"
        canManage
        canManageFacilityScope={false}
      />,
    );
    expect(screen.queryByRole("button", { name: "Manage access" })).not.toBeInTheDocument();
  });
});
