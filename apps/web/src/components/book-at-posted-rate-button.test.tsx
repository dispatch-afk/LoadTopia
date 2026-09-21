// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookAtPostedRateButton } from "./book-at-posted-rate-button";

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

describe("BookAtPostedRateButton", () => {
  beforeEach(() => {
    apiClient.mockReset();
    refresh.mockReset();
  });

  it("shows the exact posted rate and requires confirmation before booking", async () => {
    const user = userEvent.setup();
    render(<BookAtPostedRateButton loadId="load-1" postedRate="4000.00" />);

    expect(screen.getByRole("button", { name: /book at \$4,000\.00/i })).toBeInTheDocument();
    // Clicking the trigger opens a confirmation dialog — no request fires yet.
    await user.click(screen.getByRole("button", { name: /book at \$4,000\.00/i }));
    expect(apiClient).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/binding commercial acceptance/i)).toBeInTheDocument();
  });

  it("confirming sends the exact confirmed rate and refreshes on success", async () => {
    const user = userEvent.setup();
    apiClient.mockResolvedValueOnce({ threadId: "thread-1" });
    render(<BookAtPostedRateButton loadId="load-1" postedRate="4000.00" />);

    await user.click(screen.getByRole("button", { name: /book at \$4,000\.00/i }));
    await user.click(screen.getByRole("button", { name: /^book for \$4,000\.00/i }));

    expect(apiClient).toHaveBeenCalledWith(
      "/marketplace/loads/load-1/book",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ confirmedRate: "4000.00" }),
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows a truthful, non-leaking message when the load was already covered by another carrier", async () => {
    const user = userEvent.setup();
    const { ApiError } = await import("@/lib/api-client");
    apiClient.mockRejectedValueOnce(new ApiError(409, "CONFLICT", "This load is no longer on the marketplace"));
    render(<BookAtPostedRateButton loadId="load-1" postedRate="4000.00" />);

    await user.click(screen.getByRole("button", { name: /book at \$4,000\.00/i }));
    await user.click(screen.getByRole("button", { name: /^book for \$4,000\.00/i }));

    expect(await screen.findByText(/already been covered by another carrier/i)).toBeInTheDocument();
    // Never exposes who won or at what amount.
    expect(screen.queryByText(/winner|winning/i)).not.toBeInTheDocument();
  });

  it("shows a terms-changed message and refreshes when the posted rate changed underneath the carrier", async () => {
    const user = userEvent.setup();
    const { ApiError } = await import("@/lib/api-client");
    apiClient.mockRejectedValueOnce(
      new ApiError(409, "COMMERCIAL_TERMS_CHANGED", "The posted rate has changed"),
    );
    render(<BookAtPostedRateButton loadId="load-1" postedRate="4000.00" />);

    await user.click(screen.getByRole("button", { name: /book at \$4,000\.00/i }));
    await user.click(screen.getByRole("button", { name: /^book for \$4,000\.00/i }));

    expect(await screen.findByText(/commercial terms.*changed/i)).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
