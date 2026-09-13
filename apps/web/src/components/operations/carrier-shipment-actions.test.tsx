// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CarrierShipmentActions } from "./carrier-shipment-actions";
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

describe("CarrierShipmentActions", () => {
  beforeEach(() => {
    apiClient.mockReset();
    refresh.mockReset();
  });

  it("confirms pickup immediately — no confirmation step for a low-stakes movement", async () => {
    const user = userEvent.setup();
    apiClient.mockResolvedValueOnce(undefined);
    const load = buildLoadView({ status: "CARRIER_ASSIGNED", availableTransitions: ["PICKED_UP"] });
    render(<CarrierShipmentActions load={load} />);

    await user.click(screen.getByRole("button", { name: "Confirm pickup" }));

    expect(apiClient).toHaveBeenCalledWith("/loads/load-1/pickup", expect.objectContaining({ method: "POST" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("requires an explicit confirmation before marking the load delivered", async () => {
    const user = userEvent.setup();
    apiClient.mockResolvedValueOnce(undefined);
    const load = buildLoadView({ status: "IN_TRANSIT", availableTransitions: ["DELIVERED"] });
    render(<CarrierShipmentActions load={load} />);

    await user.click(screen.getByRole("button", { name: "Mark delivered" }));
    expect(apiClient).not.toHaveBeenCalled();
    expect(screen.getByText(/records physical delivery/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mark delivered" }));

    expect(apiClient).toHaveBeenCalledWith("/loads/load-1/deliver", expect.objectContaining({ method: "POST" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("cancelling the delivery confirmation never calls the API", async () => {
    const user = userEvent.setup();
    const load = buildLoadView({ status: "IN_TRANSIT", availableTransitions: ["DELIVERED"] });
    render(<CarrierShipmentActions load={load} />);

    await user.click(screen.getByRole("button", { name: "Mark delivered" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(apiClient).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Mark delivered" })).toBeInTheDocument();
  });

  it("shows a plain status message once delivered — no stray action button", () => {
    const load = buildLoadView({ status: "DELIVERED", availableTransitions: [] });
    render(<CarrierShipmentActions load={load} />);

    expect(screen.getByText(/POD review and completion are handled by the shipper/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("re-fetches the shipment on a 409 rather than showing a raw error", async () => {
    const user = userEvent.setup();
    const { ApiError } = await import("@/lib/api-client");
    apiClient.mockRejectedValueOnce(new ApiError(409, "STALE_LOAD", "conflict"));
    const load = buildLoadView({ status: "CARRIER_ASSIGNED", availableTransitions: ["PICKED_UP"] });
    render(<CarrierShipmentActions load={load} />);

    await user.click(screen.getByRole("button", { name: "Confirm pickup" }));

    expect(await screen.findByText(/page has been refreshed/i)).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
