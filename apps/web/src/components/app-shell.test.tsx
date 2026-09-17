// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";
import { buildMembershipView, buildMeResponse } from "@/test/fixtures";

let pathname = "/dashboard";
const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push, refresh }),
}));

import type * as ApiClientModule from "@/lib/api-client";

const apiClient = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiClient: (...args: unknown[]) => apiClient(...args) };
});

// Mirrors the real permission grants (packages/domain/src/authz/permissions.ts)
// closely enough to exercise the shell's nav-visibility filter — the web
// package does not depend on @loadtopia/domain, so these are hand-kept in
// sync with the strings nav-config.ts itself uses.
const SHIPPER_PERMISSIONS = [
  "load:read:own",
  "load:create",
  "network:request",
  "network:manage",
  "location:read",
  "equipment:read",
];
const CARRIER_PERMISSIONS = [
  "marketplace:browse",
  "offer:create",
  "network:request",
  "network:manage",
  "location:read",
  "equipment:read",
  "carrier:profile:manage",
];

function shipperMe(overrides: Parameters<typeof buildMeResponse>[0] = {}) {
  return buildMeResponse({ permissions: SHIPPER_PERMISSIONS, ...overrides });
}
function carrierMe(overrides: Parameters<typeof buildMeResponse>[0] = {}) {
  return buildMeResponse({
    memberships: [buildMembershipView({ companyType: "CARRIER", role: "CARRIER" })],
    permissions: CARRIER_PERMISSIONS,
    ...overrides,
  });
}

describe("AppShell", () => {
  beforeEach(() => {
    pathname = "/dashboard";
    apiClient.mockReset().mockResolvedValue({});
    push.mockReset();
    refresh.mockReset();
  });

  it("shows exactly the locked shipper primary nav, and no carrier-only items", () => {
    render(<AppShell me={shipperMe()}>content</AppShell>);
    for (const label of ["Dashboard", "Loads", "Shipments", "Carrier Network"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
    for (const label of ["Find Freight", "Connections", "My Offers", "My Shipments"]) {
      expect(screen.queryByRole("link", { name: label })).not.toBeInTheDocument();
    }
  });

  it("shows exactly the locked carrier primary nav, and no shipper-only items", () => {
    render(<AppShell me={carrierMe()}>content</AppShell>);
    for (const label of ["Dashboard", "Find Freight", "Connections", "My Offers", "My Shipments"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
    for (const label of ["Loads", "Shipments", "Carrier Network"]) {
      expect(screen.queryByRole("link", { name: label })).not.toBeInTheDocument();
    }
  });

  it("never renders a Reports link for either role", () => {
    const { rerender } = render(<AppShell me={shipperMe()}>content</AppShell>);
    expect(screen.queryByText(/reports/i)).not.toBeInTheDocument();
    rerender(<AppShell me={carrierMe()}>content</AppShell>);
    expect(screen.queryByText(/reports/i)).not.toBeInTheDocument();
  });

  it("shows the + Post a Load CTA for a shipper, and no fabricated CTA for a carrier", () => {
    const { rerender } = render(<AppShell me={shipperMe()}>content</AppShell>);
    expect(screen.getByText("+ Post a Load")).toBeInTheDocument();
    expect(screen.getByText("+ Post")).toBeInTheDocument(); // compact mobile-bar CTA

    rerender(<AppShell me={carrierMe()}>content</AppShell>);
    expect(screen.queryByText("+ Post a Load")).not.toBeInTheDocument();
    expect(screen.queryByText("+ Post")).not.toBeInTheDocument();
  });

  it("marks the current route active with aria-current, and no other item", () => {
    pathname = "/loads";
    render(<AppShell me={shipperMe()}>content</AppShell>);
    expect(screen.getByRole("link", { name: "Loads" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });

  it("hides Carrier Groups from a carrier's secondary nav (shipper-only concept)", () => {
    render(<AppShell me={carrierMe()}>content</AppShell>);
    expect(screen.queryByRole("link", { name: "Carrier Groups" })).not.toBeInTheDocument();
  });

  it("shows Carrier Groups in a shipper's secondary nav when permitted", () => {
    render(<AppShell me={shipperMe()}>content</AppShell>);
    expect(screen.getByRole("link", { name: "Carrier Groups" })).toBeInTheDocument();
  });

  it("mobile menu: closed by default, opens on trigger, and makes Sign out reachable", async () => {
    const user = userEvent.setup();
    render(<AppShell me={shipperMe()}>content</AppShell>);

    const trigger = screen.getByRole("button", { name: "Open menu" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("mobile-nav-panel")).not.toBeInTheDocument();

    await user.click(trigger);

    const reopened = screen.getByRole("button", { name: "Close menu" });
    expect(reopened).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById("mobile-nav-panel");
    expect(panel).toBeInTheDocument();
    expect(within(panel as HTMLElement).getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("clicking a nav link inside the open mobile menu closes it", async () => {
    const user = userEvent.setup();
    render(<AppShell me={shipperMe()}>content</AppShell>);
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const panel = document.getElementById("mobile-nav-panel") as HTMLElement;
    await user.click(within(panel).getByRole("link", { name: "Shipments" }));
    expect(document.getElementById("mobile-nav-panel")).not.toBeInTheDocument();
  });

  it("switching active company navigates to /dashboard and refreshes", async () => {
    const user = userEvent.setup();
    const me = shipperMe({
      memberships: [
        buildMembershipView({ companyId: "company-1", companyName: "Acme", isPrimary: true }),
        buildMembershipView({
          membershipId: "membership-2",
          companyId: "company-2",
          companyName: "Second Co",
          companyType: "CARRIER",
          role: "CARRIER",
          isPrimary: false,
        }),
      ],
      activeCompanyId: "company-1",
    });
    render(<AppShell me={me}>content</AppShell>);

    const select = screen.getByLabelText("Active company");
    await user.selectOptions(select, "company-2");

    expect(apiClient).toHaveBeenCalledWith(
      "/auth/switch-company",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ companyId: "company-2" }) }),
    );
    expect(push).toHaveBeenCalledWith("/dashboard");
    expect(refresh).toHaveBeenCalled();
  });
});
