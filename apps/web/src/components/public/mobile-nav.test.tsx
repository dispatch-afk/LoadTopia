// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MobileNav } from "./mobile-nav";

describe("MobileNav", () => {
  it("is closed by default, with aria-expanded false and no panel in the DOM", () => {
    render(<MobileNav signedIn={false} />);
    const trigger = screen.getByRole("button", { name: "Open menu" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("public-mobile-nav-panel")).not.toBeInTheDocument();
  });

  it("opens on click, updates aria-expanded, and exposes every required action", async () => {
    const user = userEvent.setup();
    render(<MobileNav signedIn={false} />);
    await user.click(screen.getByRole("button", { name: "Open menu" }));

    const trigger = screen.getByRole("button", { name: "Close menu" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const panel = document.getElementById("public-mobile-nav-panel") as HTMLElement;
    expect(panel).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "For Shippers" })).toHaveAttribute("href", "#shippers");
    expect(within(panel).getByRole("link", { name: "For Carriers" })).toHaveAttribute("href", "#carriers");
    expect(within(panel).getByRole("link", { name: "Sign In" })).toHaveAttribute("href", "/login");
    expect(within(panel).getByRole("button", { name: "Get Started" })).toBeInTheDocument();
  });

  it("shows Open Dashboard instead of Sign In when signed in", async () => {
    const user = userEvent.setup();
    render(<MobileNav signedIn={true} />);
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const panel = document.getElementById("public-mobile-nav-panel") as HTMLElement;
    expect(within(panel).getByRole("link", { name: "Open Dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(within(panel).queryByText("Sign In")).not.toBeInTheDocument();
  });

  it("closes when a link inside the panel is clicked", async () => {
    const user = userEvent.setup();
    render(<MobileNav signedIn={false} />);
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const panel = document.getElementById("public-mobile-nav-panel") as HTMLElement;
    await user.click(within(panel).getByRole("link", { name: "For Shippers" }));
    expect(document.getElementById("public-mobile-nav-panel")).not.toBeInTheDocument();
  });

  it("toggling twice closes it again", async () => {
    const user = userEvent.setup();
    render(<MobileNav signedIn={false} />);
    const trigger = screen.getByRole("button");
    await user.click(trigger);
    expect(document.getElementById("public-mobile-nav-panel")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close menu" }));
    expect(document.getElementById("public-mobile-nav-panel")).not.toBeInTheDocument();
  });
});
