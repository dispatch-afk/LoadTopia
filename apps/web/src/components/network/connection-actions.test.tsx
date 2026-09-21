// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionActions } from "./connection-actions";
import { buildConnectionView } from "@/test/fixtures";

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

describe("ConnectionActions", () => {
  beforeEach(() => {
    apiClient.mockReset();
    refresh.mockReset();
  });

  it("a company-primary/admin viewer sees Accept/Decline on a request awaiting their response", () => {
    const connection = buildConnectionView({ status: "PENDING", awaitingMyResponse: true });
    render(<ConnectionActions connection={connection} canManage counterpartNoun="carrier" />);
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
  });

  it("an ordinary member sees no management actions, only a factual status line", () => {
    const connection = buildConnectionView({ status: "PENDING", awaitingMyResponse: true });
    render(<ConnectionActions connection={connection} canManage={false} counterpartNoun="carrier" />);
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Decline" })).not.toBeInTheDocument();
    expect(screen.getByText(/awaiting a company admin/i)).toBeInTheDocument();
  });

  it("the requester sees a waiting message, never Accept/Decline for their own request", () => {
    const connection = buildConnectionView({ status: "PENDING", awaitingMyResponse: false });
    render(<ConnectionActions connection={connection} canManage counterpartNoun="carrier" />);
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    expect(screen.getByText(/waiting for the other company/i)).toBeInTheDocument();
  });

  it("accept requires the exact required confirmation copy before calling the API", async () => {
    const user = userEvent.setup();
    apiClient.mockResolvedValueOnce(buildConnectionView({ status: "ACCEPTED" }));
    const connection = buildConnectionView({ status: "PENDING", awaitingMyResponse: true });
    render(<ConnectionActions connection={connection} canManage counterpartNoun="carrier" />);

    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(apiClient).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/connecting your company and this carrier as business partners/i);
    expect(dialog).toHaveTextContent(/does not automatically give this company access to all of your freight/i);

    await user.click(within(dialog).getByRole("button", { name: "Connect" }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        `/connections/${connection.id}/accept`,
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("decline requires confirmation and never sends a reason", async () => {
    const user = userEvent.setup();
    apiClient.mockResolvedValueOnce(buildConnectionView({ status: "DECLINED" }));
    const connection = buildConnectionView({ status: "PENDING", awaitingMyResponse: true });
    render(<ConnectionActions connection={connection} canManage counterpartNoun="carrier" />);

    await user.click(screen.getByRole("button", { name: "Decline" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/no reason is shared/i);
    expect(dialog.querySelector("textarea, input[type=text]")).toBeNull();

    await user.click(within(dialog).getByRole("button", { name: "Decline" }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        `/connections/${connection.id}/decline`,
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(apiClient.mock.calls[0]?.[1]).not.toHaveProperty("body");
  });

  it("disconnect requires confirmation explaining history is preserved", async () => {
    const user = userEvent.setup();
    apiClient.mockResolvedValueOnce(buildConnectionView({ status: "DISCONNECTED" }));
    const connection = buildConnectionView({ status: "ACCEPTED" });
    render(<ConnectionActions connection={connection} canManage counterpartNoun="carrier" />);

    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/historical transactions.*are not deleted/i);
    expect(dialog).toHaveTextContent(/different from a block/i);

    await user.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        `/connections/${connection.id}/disconnect`,
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});
