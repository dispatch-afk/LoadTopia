// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AudiencePreviewView, ConnectionView } from "@loadtopia/shared";
import { ReviewPostForm } from "./review-post-form";
import { buildLoadView } from "@/test/fixtures";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

import type * as ApiClientModule from "@/lib/api-client";

const apiClient = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiClient: (...args: unknown[]) => apiClient(...args) };
});

function connection(overrides: Partial<ConnectionView> = {}): ConnectionView {
  return {
    id: "conn-1",
    companyAId: "a",
    companyBId: "b",
    counterpartCompanyId: "carrier-1",
    counterpartCompanyName: "Longhorn Transportation",
    status: "ACCEPTED",
    requesterCompanyId: "a",
    awaitingMyResponse: false,
    requestedAt: "2026-01-01T00:00:00.000Z",
    respondedAt: "2026-01-01T00:00:00.000Z",
    disconnectedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    sharedHistory: {
      shipmentsTogether: 0,
      completedShipments: 0,
      activeShipments: 0,
      lastWorkedTogether: null,
    },
    ...overrides,
  };
}

const previewResponse = (over: Partial<AudiencePreviewView> = {}): AudiencePreviewView => ({
  strategy: "MARKETPLACE",
  eligibleCarrierCount: null,
  ineligibleSelectedCount: 0,
  ...over,
});

describe("ReviewPostForm", () => {
  beforeEach(() => {
    apiClient.mockReset();
    push.mockReset();
    refresh.mockReset();
  });

  it("defaults to Marketplace and posts with that strategy behind a confirmation", async () => {
    const user = userEvent.setup();
    apiClient.mockImplementation((path: string) =>
      path.includes("audience-preview")
        ? Promise.resolve(previewResponse())
        : Promise.resolve(undefined),
    );
    const load = buildLoadView({ status: "DRAFT" });
    render(<ReviewPostForm load={load} connections={[]} groups={[]} />);

    await waitFor(() => expect(apiClient).toHaveBeenCalled());

    const postButton = screen.getByRole("button", { name: "Post load" });
    expect(postButton).toBeEnabled();
    await user.click(postButton);

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Post load" }));

    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        "/loads/load-1/post",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ strategy: "MARKETPLACE" }) }),
      ),
    );
  });

  it("Selected Carriers First stays disabled until a carrier is chosen", async () => {
    const user = userEvent.setup();
    // The preview always reports one eligible carrier once queried — the
    // gating behavior under test is the CLIENT-SIDE "nothing selected yet"
    // guard (selectedCount === 0), independent of what the server preview says.
    apiClient.mockImplementation(() => Promise.resolve(previewResponse({ eligibleCarrierCount: 1 })));
    const load = buildLoadView({ status: "DRAFT" });
    render(<ReviewPostForm load={load} connections={[connection()]} groups={[]} />);

    await user.click(screen.getByRole("button", { name: /selected carriers first/i }));
    await waitFor(() => expect(apiClient).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Post load" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Longhorn Transportation" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Post load" })).toBeEnabled());
  });

  it("shows the exact scheduled release timestamp after picking a preset", async () => {
    const user = userEvent.setup();
    apiClient.mockImplementation(() => Promise.resolve(previewResponse({ eligibleCarrierCount: 2 })));
    const load = buildLoadView({ status: "DRAFT" });
    render(<ReviewPostForm load={load} connections={[]} groups={[]} />);

    await user.click(screen.getByRole("button", { name: /my carrier network first/i }));
    await user.click(screen.getByRole("button", { name: "4h" }));

    expect(await screen.findByText(/Release scheduled for/)).toBeInTheDocument();
  });

  it("only the clicked preset shows as selected — not every preset button at once", async () => {
    const user = userEvent.setup();
    apiClient.mockImplementation(() => Promise.resolve(previewResponse({ eligibleCarrierCount: 2 })));
    const load = buildLoadView({ status: "DRAFT" });
    render(<ReviewPostForm load={load} connections={[]} groups={[]} />);

    await user.click(screen.getByRole("button", { name: /my carrier network first/i }));
    await user.click(screen.getByRole("button", { name: "4h" }));

    expect(screen.getByRole("button", { name: "4h" })).toHaveAttribute("aria-pressed", "true");
    for (const label of ["1h", "2h", "8h", "12h", "24h"]) {
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("a zero-eligible-audience preview blocks posting with a truthful message", async () => {
    const user = userEvent.setup();
    apiClient.mockImplementation(() => Promise.resolve(previewResponse({ eligibleCarrierCount: 0 })));
    const load = buildLoadView({ status: "DRAFT" });
    render(<ReviewPostForm load={load} connections={[]} groups={[]} />);

    await user.click(screen.getByRole("button", { name: /my carrier network first/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/No eligible carriers yet — choose Marketplace, or connect\/select carriers first\./),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Post load" })).toBeDisabled();
  });
});
