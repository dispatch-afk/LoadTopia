// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlockControl } from "./block-control";

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

describe("BlockControl", () => {
  beforeEach(() => {
    apiClient.mockReset();
    refresh.mockReset();
  });

  it("a company-primary/admin viewer can initiate a block behind a confirmation", async () => {
    const user = userEvent.setup();
    apiClient.mockResolvedValueOnce({ status: "ACTIVE" });
    render(<BlockControl companyId="company-2" canManage initialStatus={null} />);

    await user.click(screen.getByRole("button", { name: "Block this company" }));
    expect(apiClient).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Block" }));

    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        "/companies/company-2/block",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(await screen.findByText("Blocked")).toBeInTheDocument();
  });

  it("shows the ACTIVE result as 'Blocked'", () => {
    render(<BlockControl companyId="company-2" canManage initialStatus="ACTIVE" />);
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText(/future interaction with this company is restricted/i)).toBeInTheDocument();
  });

  it("shows the PENDING_ON_COMPLETION result truthfully, distinct from an active block", () => {
    render(<BlockControl companyId="company-2" canManage initialStatus="PENDING_ON_COMPLETION" />);
    expect(screen.getByText("Block pending completion")).toBeInTheDocument();
    expect(screen.getByText(/existing freight must remain accessible until it is completed/i)).toBeInTheDocument();
  });

  it("renders nothing for a viewer without manage authority — the counterpart never sees this control", () => {
    const { container } = render(<BlockControl companyId="company-2" canManage={false} initialStatus="ACTIVE" />);
    expect(container).toBeEmptyDOMElement();
  });
});
