// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadView } from "@loadtopia/shared";
import { AudiencePanel } from "./audience-panel";
import { buildLoadView } from "@/test/fixtures";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import type * as ApiClientModule from "@/lib/api-client";

const apiClient = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiClient: (...args: unknown[]) => apiClient(...args) };
});

function withAudience(overrides: Partial<LoadView["audience"]> = {}): LoadView {
  return buildLoadView({
    status: "POSTED",
    audience: {
      strategy: "SELECTED_FIRST",
      currentStage: "SELECTED",
      autoReleaseDisabled: false,
      audienceCount: 3,
      pendingReleases: [
        {
          id: "release-1",
          toStage: "NETWORK",
          status: "PENDING",
          scheduledAt: "2026-09-14T19:30:00.000Z",
          executedAt: null,
          cancelledAt: null,
          cancelReason: null,
        },
      ],
      ...overrides,
    },
  });
}

describe("AudiencePanel", () => {
  beforeEach(() => {
    apiClient.mockReset();
    refresh.mockReset();
  });

  it("renders nothing for a DRAFT/legacy load with no recorded strategy", () => {
    const load = buildLoadView({ status: "DRAFT", audience: null });
    const { container } = render(<AudiencePanel load={load} canManage />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the current stage, strategy, and next scheduled release", () => {
    render(<AudiencePanel load={withAudience()} canManage />);
    expect(screen.getByText("Selected carriers first")).toBeInTheDocument();
    expect(screen.getByText("Selected carriers")).toBeInTheDocument();
    expect(screen.getByText(/3 carriers/)).toBeInTheDocument();
  });

  it("a non-managing viewer sees no release controls", () => {
    render(<AudiencePanel load={withAudience()} canManage={false} />);
    expect(screen.queryByRole("button", { name: /release/i })).not.toBeInTheDocument();
  });

  it("release now requires confirmation before calling the API", async () => {
    const user = userEvent.setup();
    apiClient.mockResolvedValueOnce(undefined);
    render(<AudiencePanel load={withAudience()} canManage />);

    await user.click(screen.getByRole("button", { name: /release to marketplace now/i }));
    expect(apiClient).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Release now" }));

    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        "/loads/load-1/release-now",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ target: "MARKETPLACE" }) }),
      ),
    );
  });

  it("cancelling a scheduled release requires confirmation", async () => {
    const user = userEvent.setup();
    apiClient.mockResolvedValueOnce(undefined);
    render(<AudiencePanel load={withAudience()} canManage />);

    await user.click(screen.getByRole("button", { name: "Cancel release" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel release" }));

    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        "/loads/load-1/audience-releases/release-1/cancel",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("a load already at Marketplace stage shows no further release controls", () => {
    render(
      <AudiencePanel
        load={withAudience({ currentStage: "MARKETPLACE", pendingReleases: [] })}
        canManage
      />,
    );
    expect(screen.queryByRole("button", { name: /release/i })).not.toBeInTheDocument();
    expect(screen.getByText("No further release scheduled")).toBeInTheDocument();
  });
});
