// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RegisterPage from "./page";

let query = "";
const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
  useSearchParams: () => new URLSearchParams(query),
}));

import type * as ApiClientModule from "@/lib/api-client";

const apiClient = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiClient: (...args: unknown[]) => apiClient(...args) };
});

describe("RegisterPage — Milestone 4 public-site role preselection", () => {
  beforeEach(() => {
    query = "";
    apiClient.mockReset().mockResolvedValue({});
    replace.mockReset();
    refresh.mockReset();
  });

  it("defaults to Shipper when no type param is present", () => {
    render(<RegisterPage />);
    expect(screen.getByLabelText("Company type")).toHaveValue("SHIPPER");
  });

  it("preselects Shipper for ?type=shipper", () => {
    query = "type=shipper";
    render(<RegisterPage />);
    expect(screen.getByLabelText("Company type")).toHaveValue("SHIPPER");
  });

  it("preselects Carrier for ?type=carrier", () => {
    query = "type=carrier";
    render(<RegisterPage />);
    expect(screen.getByLabelText("Company type")).toHaveValue("CARRIER");
  });

  it("falls back to Shipper for an invalid type param", () => {
    query = "type=broker";
    render(<RegisterPage />);
    expect(screen.getByLabelText("Company type")).toHaveValue("SHIPPER");
  });

  it("lets the user change the preselected company type before submitting", async () => {
    const user = userEvent.setup();
    query = "type=carrier";
    render(<RegisterPage />);
    const select = screen.getByLabelText("Company type");
    expect(select).toHaveValue("CARRIER");
    await user.selectOptions(select, "SHIPPER");
    expect(select).toHaveValue("SHIPPER");
  });

  it("submits the same payload shape regardless of preselection — registration semantics unchanged", async () => {
    const user = userEvent.setup();
    query = "type=carrier";
    render(<RegisterPage />);

    await user.type(screen.getByLabelText("First name"), "Sam");
    await user.type(screen.getByLabelText("Last name"), "Carrier");
    await user.type(screen.getByLabelText("Work email"), "sam@it.test");
    await user.type(screen.getByLabelText("Password", { exact: false }), "a-very-long-password");
    await user.type(screen.getByLabelText("Company name"), "Sam Trucking");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(apiClient).toHaveBeenCalledWith(
      "/auth/register",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          firstName: "Sam",
          lastName: "Carrier",
          email: "sam@it.test",
          password: "a-very-long-password",
          companyName: "Sam Trucking",
          companyType: "CARRIER",
        }),
      }),
    );
  });
});
