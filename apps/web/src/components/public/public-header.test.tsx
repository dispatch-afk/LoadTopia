// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PublicHeader } from "./public-header";

describe("PublicHeader", () => {
  it("shows Sign In → /login when signed out", () => {
    render(<PublicHeader signedIn={false} />);
    const signIn = screen.getAllByRole("link", { name: "Sign In" })[0];
    expect(signIn).toHaveAttribute("href", "/login");
    expect(screen.queryByText("Open Dashboard")).not.toBeInTheDocument();
  });

  it("shows Open Dashboard → /dashboard when signed in, never Sign In", () => {
    render(<PublicHeader signedIn={true} />);
    const dash = screen.getAllByRole("link", { name: "Open Dashboard" })[0];
    expect(dash).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByText("Sign In")).not.toBeInTheDocument();
  });

  it("exposes For Shippers / For Carriers as in-page anchors, no new route", () => {
    render(<PublicHeader signedIn={false} />);
    expect(screen.getAllByRole("link", { name: "For Shippers" })[0]).toHaveAttribute("href", "#shippers");
    expect(screen.getAllByRole("link", { name: "For Carriers" })[0]).toHaveAttribute("href", "#carriers");
  });

  it("Get Started routes to generic registration", () => {
    render(<PublicHeader signedIn={false} />);
    expect(screen.getAllByRole("link", { name: "Get Started" })[0]).toHaveAttribute("href", "/register");
  });

  it("never renders a Reports/Pricing/Analytics/AI/Payments nav item", () => {
    render(<PublicHeader signedIn={false} />);
    const body = document.body.textContent?.toLowerCase() ?? "";
    for (const banned of ["reports", "pricing intelligence", "analytics", "payments", "integrations"]) {
      expect(body).not.toContain(banned);
    }
  });
});
