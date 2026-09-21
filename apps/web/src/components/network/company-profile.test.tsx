// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CompanyProfile } from "./company-profile";
import { buildCompanyProfileView, buildConnectionView } from "@/test/fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/api-client", () => ({
  apiClient: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

describe("CompanyProfile", () => {
  it("renders factual identity and capabilities, no fabricated scores", () => {
    const profile = buildCompanyProfileView();
    render(
      <CompanyProfile myCompanyId="company-1" myCompanyType="SHIPPER" canManage profile={profile} allGroups={[]} />,
    );
    expect(screen.getByRole("heading", { name: "Longhorn Transportation" })).toBeInTheDocument();
    expect(screen.getByText(/Carrier · Austin, TX/)).toBeInTheDocument();
    expect(screen.getByText("Longhorn Transportation LLC")).toBeInTheDocument();
    // No phantom trust/score language anywhere on the page.
    const body = document.body.textContent ?? "";
    for (const phrase of ["Trusted", "Top Carrier", "Best Carrier", "Score", "Recommended", "Rating"]) {
      expect(body).not.toContain(phrase);
    }
  });

  it("shows a truthful zero-history state for a pair with no verified shared freight", () => {
    const profile = buildCompanyProfileView({
      relationship: {
        connection: buildConnectionView({ status: "ACCEPTED" }),
        connectionEvents: [],
        isFollowing: null,
        preference: null,
        blockStatus: null,
        groups: null,
      },
    });
    render(
      <CompanyProfile myCompanyId="company-1" myCompanyType="SHIPPER" canManage profile={profile} allGroups={[]} />,
    );
    expect(screen.getByText("No verified shared freight yet.")).toBeInTheDocument();
  });

  it("shows a verified relationship summary when shared history exists", () => {
    const profile = buildCompanyProfileView({
      relationship: {
        connection: buildConnectionView({ status: "ACCEPTED" }),
        connectionEvents: [],
        isFollowing: null,
        preference: null,
        blockStatus: null,
        groups: null,
      },
      sharedHistory: {
        shipmentsTogether: 4,
        completedShipments: 4,
        activeShipments: 0,
        lastWorkedTogether: "2026-08-15T00:00:00.000Z",
        recentLanes: [],
      },
    });
    render(
      <CompanyProfile myCompanyId="company-1" myCompanyType="SHIPPER" canManage profile={profile} allGroups={[]} />,
    );
    expect(screen.getByText("4 completed shipments together")).toBeInTheDocument();
    expect(screen.getByText(/last worked together/i)).toBeInTheDocument();
  });

  it("never shows preference or group controls to a carrier viewing a shipper", () => {
    const shipperProfile = buildCompanyProfileView({
      id: "company-1",
      type: "SHIPPER",
      name: "Acme Manufacturing",
      capabilities: null,
      relationship: {
        connection: buildConnectionView({ status: "ACCEPTED" }),
        connectionEvents: [],
        isFollowing: true,
        preference: null,
        blockStatus: null,
        groups: null,
      },
    });
    render(
      <CompanyProfile myCompanyId="carrier-1" myCompanyType="CARRIER" canManage profile={shipperProfile} allGroups={[]} />,
    );
    expect(screen.queryByText(/private preference/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/carrier groups/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Following" })).toBeInTheDocument();
  });
});
