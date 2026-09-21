// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FollowToggle } from "./follow-toggle";

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

describe("FollowToggle", () => {
  beforeEach(() => {
    apiClient.mockReset();
    refresh.mockReset();
  });

  it("follows immediately with no confirmation dialog", async () => {
    const user = userEvent.setup();
    apiClient.mockResolvedValueOnce(undefined);
    render(<FollowToggle shipperCompanyId="company-1" initiallyFollowing={false} />);

    await user.click(screen.getByRole("button", { name: "Follow" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith(
      "/companies/company-1/follow",
      expect.objectContaining({ method: "POST" }),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Following" })).toBeInTheDocument());
  });

  it("unfollows immediately, also with no confirmation dialog", async () => {
    const user = userEvent.setup();
    apiClient.mockResolvedValueOnce(undefined);
    render(<FollowToggle shipperCompanyId="company-1" initiallyFollowing />);

    await user.click(screen.getByRole("button", { name: "Following" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith(
      "/companies/company-1/follow",
      expect.objectContaining({ method: "DELETE" }),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Follow" })).toBeInTheDocument());
  });
});
