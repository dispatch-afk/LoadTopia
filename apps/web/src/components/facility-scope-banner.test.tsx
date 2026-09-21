// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FacilityScopeBanner } from "./facility-scope-banner";

describe("FacilityScopeBanner", () => {
  it("renders the exact factual copy for a facility-scoped user", () => {
    render(<FacilityScopeBanner scoped={true} />);
    expect(screen.getByText("Showing freight for your assigned facilities.")).toBeInTheDocument();
  });

  it("renders nothing for a company-wide user", () => {
    render(<FacilityScopeBanner scoped={false} />);
    expect(screen.queryByText(/assigned facilities/i)).not.toBeInTheDocument();
  });

  it("renders nothing when scope status cannot be determined", () => {
    render(<FacilityScopeBanner scoped={null} />);
    expect(screen.queryByText(/assigned facilities/i)).not.toBeInTheDocument();
  });

  it("never renders any digit — no hidden-freight count can leak through this component", () => {
    render(<FacilityScopeBanner scoped={true} />);
    const text = screen.getByText("Showing freight for your assigned facilities.").textContent ?? "";
    expect(text).not.toMatch(/\d/);
  });
});
