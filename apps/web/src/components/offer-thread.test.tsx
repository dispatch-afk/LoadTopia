// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OfferThread } from "./offer-thread";
import { buildOfferThreadView } from "@/test/fixtures";

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

describe("OfferThread", () => {
  beforeEach(() => {
    apiClient.mockReset();
    refresh.mockReset();
  });

  it("shows only the actions the server authorized for this viewer", () => {
    const thread = buildOfferThreadView({
      actions: { canCounter: true, canAccept: true, canReject: false, canWithdraw: false },
    });
    render(<OfferThread thread={thread} />);

    expect(screen.getByRole("button", { name: /^accept/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Counter" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Withdraw" })).not.toBeInTheDocument();
  });

  it("formats the current amount with the shared money formatter", () => {
    const thread = buildOfferThreadView({ currentAmount: "1750.5", currentCurrency: "USD" });
    render(<OfferThread thread={thread} />);
    expect(screen.getByText("$1,750.50")).toBeInTheDocument();
  });

  it("accepting calls the round-accept endpoint and refreshes the page", async () => {
    const user = userEvent.setup();
    apiClient.mockResolvedValueOnce(undefined);
    const thread = buildOfferThreadView({
      actions: { canCounter: false, canAccept: true, canReject: false, canWithdraw: false },
    });
    render(<OfferThread thread={thread} />);

    await user.click(screen.getByRole("button", { name: /^accept/i }));

    expect(apiClient).toHaveBeenCalledWith(
      "/offers/rounds/round-1/accept",
      expect.objectContaining({ method: "POST" }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("opens the counter form and submits the entered amount", async () => {
    const user = userEvent.setup();
    apiClient.mockResolvedValueOnce(undefined);
    const thread = buildOfferThreadView({
      currentCurrency: "USD",
      actions: { canCounter: true, canAccept: false, canReject: false, canWithdraw: false },
    });
    render(<OfferThread thread={thread} />);

    await user.click(screen.getByRole("button", { name: "Counter" }));
    const amountInput = screen.getByPlaceholderText("1750.00");
    await user.type(amountInput, "1800.00");
    await user.click(screen.getByRole("button", { name: /send counter/i }));

    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        "/offers/rounds/round-1/counter",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ amount: "1800.00", currency: "USD", message: undefined }),
        }),
      ),
    );
  });

  it("shows an error message returned by the API without crashing", async () => {
    const user = userEvent.setup();
    const { ApiError } = await import("@/lib/api-client");
    apiClient.mockRejectedValueOnce(new ApiError(409, "STALE_ROUND", "This round has expired"));
    const thread = buildOfferThreadView({
      actions: { canCounter: false, canAccept: true, canReject: false, canWithdraw: false },
    });
    render(<OfferThread thread={thread} />);

    await user.click(screen.getByRole("button", { name: /^accept/i }));

    expect(await screen.findByText("This round has expired")).toBeInTheDocument();
  });
});
