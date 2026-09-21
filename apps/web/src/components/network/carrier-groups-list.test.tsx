// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CarrierGroupsList } from "./carrier-groups-list";

import type * as ApiClientModule from "@/lib/api-client";

const apiClient = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiClient: (...args: unknown[]) => apiClient(...args) };
});

const group = {
  id: "group-1",
  name: "Texas Dry Van",
  memberCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("CarrierGroupsList", () => {
  beforeEach(() => {
    apiClient.mockReset();
  });

  it("shows the truthful empty state when there are no groups", () => {
    render(<CarrierGroupsList initial={[]} />);
    expect(
      screen.getByText("No Carrier Groups yet. Create a group to organize connected carriers."),
    ).toBeInTheDocument();
  });

  it("creates a group from just a name — no decorative configuration offered", async () => {
    const user = userEvent.setup();
    apiClient.mockResolvedValueOnce(group);
    render(<CarrierGroupsList initial={[]} />);

    await user.click(screen.getByRole("button", { name: "+ New group" }));
    await user.type(screen.getByLabelText(/group name/i), "Texas Dry Van");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        "/carrier-groups",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "Texas Dry Van" }) }),
      ),
    );
    expect(await screen.findByText("Texas Dry Van")).toBeInTheDocument();
    // No description/color/icon/tag fields anywhere in the create form.
    expect(screen.queryByLabelText(/description/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/color/i)).not.toBeInTheDocument();
  });

  it("deletes a group behind a confirmation, explaining carriers are not disconnected", async () => {
    const user = userEvent.setup();
    apiClient.mockResolvedValueOnce(undefined);
    render(<CarrierGroupsList initial={[group]} />);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/does not disconnect or block any carrier/i);

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        "/carrier-groups/group-1",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });
});
