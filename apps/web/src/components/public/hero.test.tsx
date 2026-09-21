// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Hero } from "./hero";

describe("Hero", () => {
  it("renders the locked positioning as the page's H1", () => {
    render(<Hero signedIn={false} />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("The Direct Freight Operating Platform");
  });

  it("shows both role CTAs, routed correctly, when signed out", () => {
    render(<Hero signedIn={false} />);
    expect(screen.getByRole("link", { name: "Post Your First Load" })).toHaveAttribute(
      "href",
      "/register?type=shipper",
    );
    expect(screen.getByRole("link", { name: "Find Freight" })).toHaveAttribute(
      "href",
      "/register?type=carrier",
    );
  });

  it("shows Open Dashboard instead of the registration CTAs when signed in", () => {
    render(<Hero signedIn={true} />);
    expect(screen.getByRole("link", { name: "Open Dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByText("Post Your First Load")).not.toBeInTheDocument();
    expect(screen.queryByText("Find Freight")).not.toBeInTheDocument();
  });

  it("never says 'Know the market'", () => {
    render(<Hero signedIn={false} />);
    expect(document.body.textContent?.toLowerCase()).not.toContain("know the market");
  });
});
