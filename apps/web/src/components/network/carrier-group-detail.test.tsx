// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CarrierGroupDetail } from "./carrier-group-detail";

import type * as ApiClientModule from "@/lib/api-client";

const apiClient = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiClient: (...args: unknown[]) => apiClient(...args) };
});

const emptyGroup = {
  id: "group-1",
  name: "Texas Dry Van",
  memberCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  members: [],
};

const groupWithMember = {
  ...emptyGroup,
  memberCount: 1,
  members: [{ carrierCompanyId: "carrier-1", carrierCompanyName: "Longhorn Transportation", addedAt: "2026-01-02T00:00:00.000Z" }],
};

describe("CarrierGroupDetail", () => {
  beforeEach(() => {
    apiClient.mockReset();
  });

  it("renames the group", async () => {
    const user = userEvent.setup();
    apiClient.mockResolvedValueOnce({ name: "Texas Reefer", updatedAt: "2026-01-03T00:00:00.000Z" });
    render(<CarrierGroupDetail initial={emptyGroup} initialEligible={[]} />);

    await user.click(screen.getByRole("button", { name: "Rename group" }));
    const input = screen.getByLabelText(/group name/i);
    await user.clear(input);
    await user.type(input, "Texas Reefer");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        "/carrier-groups/group-1",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "Texas Reefer" }) }),
      ),
    );
    expect(await screen.findByRole("heading", { name: "Texas Reefer" })).toBeInTheDocument();
  });

  it("only offers ACCEPTED-connected carriers as eligible to add — never disconnected/blocked/unrelated ones", async () => {
    const user = userEvent.setup();
    const eligible = [{ companyId: "carrier-2", companyName: "Rio Grande Freight" }];
    render(<CarrierGroupDetail initial={emptyGroup} initialEligible={eligible} />);

    await user.click(screen.getByRole("button", { name: "+ Add carrier" }));
    const select = screen.getByLabelText(/^carrier/i);
    expect(within(select).getByText("Rio Grande Freight")).toBeInTheDocument();
    // The eligible list came entirely from the server — no client-side
    // reconstruction of disconnected/blocked/unrelated carriers.
    expect(within(select).queryAllByRole("option")).toHaveLength(2); // placeholder + the one eligible carrier
  });

  it("disables Add carrier when there is nobody eligible", () => {
    render(<CarrierGroupDetail initial={emptyGroup} initialEligible={[]} />);
    expect(screen.getByRole("button", { name: "+ Add carrier" })).toBeDisabled();
  });

  it("adds an eligible carrier to the group", async () => {
    const user = userEvent.setup();
    const eligible = [{ companyId: "carrier-2", companyName: "Rio Grande Freight" }];
    apiClient.mockResolvedValueOnce({
      carrierCompanyId: "carrier-2",
      carrierCompanyName: "Rio Grande Freight",
      addedAt: "2026-01-05T00:00:00.000Z",
    });
    render(<CarrierGroupDetail initial={emptyGroup} initialEligible={eligible} />);

    await user.click(screen.getByRole("button", { name: "+ Add carrier" }));
    await user.selectOptions(screen.getByLabelText(/^carrier/i), "carrier-2");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        "/carrier-groups/group-1/members",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ carrierCompanyId: "carrier-2" }),
        }),
      ),
    );
    expect(await screen.findByText("Rio Grande Freight")).toBeInTheDocument();
  });

  it("removes a member behind confirmation, explaining no disconnect/block/notify occurs", async () => {
    const user = userEvent.setup();
    apiClient.mockResolvedValueOnce(undefined);
    render(<CarrierGroupDetail initial={groupWithMember} initialEligible={[]} />);

    await user.click(screen.getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/does not disconnect, block, or notify/i);

    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        "/carrier-groups/group-1/members/carrier-1",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });
});
