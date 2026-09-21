// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoadActions } from "./load-actions";
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

describe("LoadActions", () => {
  beforeEach(() => {
    apiClient.mockReset();
    push.mockReset();
    refresh.mockReset();
  });

  it("a postable DRAFT load links to Review & Post rather than posting directly", () => {
    const load = buildLoadView({ status: "DRAFT", availableTransitions: ["POSTED"] });
    render(<LoadActions load={load} />);

    const link = screen.getByRole("link", { name: /review & post/i });
    expect(link).toHaveAttribute("href", "/loads/load-1/review");
    expect(apiClient).not.toHaveBeenCalled();
  });

  it("cancelling opens a reason prompt and only calls the API once a value is submitted", async () => {
    const user = userEvent.setup();
    apiClient.mockResolvedValueOnce(undefined);
    const load = buildLoadView({ status: "POSTED", availableTransitions: ["CANCELLED"] });
    render(<LoadActions load={load} />);

    await user.click(screen.getByRole("button", { name: /cancel load/i }));
    expect(apiClient).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    const reasonInput = within(dialog).getByLabelText(/reason for cancelling/i);
    await user.type(reasonInput, "Customer cancelled");
    await user.click(within(dialog).getByRole("button", { name: "Cancel load" }));

    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        "/loads/load-1/cancel",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ reason: "Customer cancelled" }) }),
      ),
    );
  });

  it("keeping the load on the cancel prompt never calls the API", async () => {
    const user = userEvent.setup();
    const load = buildLoadView({ status: "POSTED", availableTransitions: ["CANCELLED"] });
    render(<LoadActions load={load} />);

    await user.click(screen.getByRole("button", { name: /cancel load/i }));
    await screen.findByLabelText(/reason for cancelling/i);
    await user.click(screen.getByRole("button", { name: "Keep load" }));

    await waitFor(() => expect(screen.queryByLabelText(/reason for cancelling/i)).not.toBeInTheDocument());
    expect(apiClient).not.toHaveBeenCalled();
  });

  it("deleting a draft requires confirmation before the DELETE request fires", async () => {
    const user = userEvent.setup();
    apiClient.mockResolvedValueOnce(undefined);
    const load = buildLoadView({ status: "DRAFT" });
    render(<LoadActions load={load} />);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(apiClient).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith("/loads/load-1", expect.objectContaining({ method: "DELETE" })),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/loads"));
  });
});
