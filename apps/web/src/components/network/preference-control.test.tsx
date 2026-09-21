// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PreferenceControl } from "./preference-control";

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

describe("PreferenceControl", () => {
  beforeEach(() => {
    apiClient.mockReset();
    refresh.mockReset();
  });

  it("a company-primary/admin shipper can set a preference", async () => {
    const user = userEvent.setup();
    apiClient.mockResolvedValueOnce(undefined);
    render(<PreferenceControl carrierCompanyId="carrier-1" canManage initialPreference={null} />);

    await user.click(screen.getByRole("button", { name: "Prefer" }));

    expect(apiClient).toHaveBeenCalledWith(
      "/companies/carrier-1/preference",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ preference: "PREFER" }) }),
    );
  });

  it("a company-primary/admin shipper can clear a preference", async () => {
    const user = userEvent.setup();
    apiClient.mockResolvedValueOnce(undefined);
    render(<PreferenceControl carrierCompanyId="carrier-1" canManage initialPreference="PREFER" />);

    await user.click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        "/companies/carrier-1/preference",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });

  it("an ordinary member cannot manage — read-only, no interactive controls", () => {
    render(<PreferenceControl carrierCompanyId="carrier-1" canManage={false} initialPreference="DO_NOT_PREFER" />);
    expect(screen.getByText("Do Not Prefer")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("with no preference set, an ordinary member sees a truthful 'no preference' state", () => {
    render(<PreferenceControl carrierCompanyId="carrier-1" canManage={false} initialPreference={null} />);
    expect(screen.getByText("No preference set")).toBeInTheDocument();
  });
});
