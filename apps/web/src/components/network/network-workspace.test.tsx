// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { NetworkWorkspace } from "./network-workspace";
import { buildCarrierFollowView, buildConnectionView } from "@/test/fixtures";

describe("NetworkWorkspace", () => {
  it("labels the workspace 'Carrier Network' for a shipper and shows no Following tab", () => {
    render(
      <NetworkWorkspace companyType="SHIPPER" connections={[]} follows={[]} preferences={new Map()} />,
    );
    expect(screen.getByRole("heading", { name: "Carrier Network" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /following/i })).not.toBeInTheDocument();
  });

  it("labels the workspace 'Connections' for a carrier and shows a Following tab", () => {
    render(
      <NetworkWorkspace companyType="CARRIER" connections={[]} follows={[]} preferences={new Map()} />,
    );
    expect(screen.getByRole("heading", { name: "Connections" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /following/i })).toBeInTheDocument();
  });

  it("shows the shipper-specific truthful empty state for Connected", () => {
    render(
      <NetworkWorkspace companyType="SHIPPER" connections={[]} follows={[]} preferences={new Map()} />,
    );
    expect(screen.getByText("You haven't connected with any carriers yet.")).toBeInTheDocument();
  });

  it("shows the carrier-specific truthful empty state for Connected", () => {
    render(
      <NetworkWorkspace companyType="CARRIER" connections={[]} follows={[]} preferences={new Map()} />,
    );
    expect(screen.getByText("You haven't connected with any shippers yet.")).toBeInTheDocument();
  });

  it("shows the truthful empty state for Requests", async () => {
    const user = userEvent.setup();
    render(
      <NetworkWorkspace companyType="SHIPPER" connections={[]} follows={[]} preferences={new Map()} />,
    );
    await user.click(screen.getByRole("tab", { name: /requests/i }));
    expect(screen.getByText("No connection requests need your attention.")).toBeInTheDocument();
  });

  it("shows the truthful empty state for Following (carrier only)", async () => {
    const user = userEvent.setup();
    render(
      <NetworkWorkspace companyType="CARRIER" connections={[]} follows={[]} preferences={new Map()} />,
    );
    await user.click(screen.getByRole("tab", { name: /following/i }));
    expect(screen.getByText("You aren't following any shippers yet.")).toBeInTheDocument();
  });

  it("renders an ACCEPTED connection under Connected with its factual status", () => {
    const accepted = buildConnectionView({ status: "ACCEPTED", counterpartCompanyName: "Longhorn Transportation" });
    render(
      <NetworkWorkspace companyType="SHIPPER" connections={[accepted]} follows={[]} preferences={new Map()} />,
    );
    expect(screen.getAllByText("Longhorn Transportation").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Connected").length).toBeGreaterThan(0);
  });

  it("renders a PENDING connection under Requests, flagged when awaiting this viewer's response", async () => {
    const user = userEvent.setup();
    const pending = buildConnectionView({
      status: "PENDING",
      awaitingMyResponse: true,
      counterpartCompanyName: "Longhorn Transportation",
    });
    render(
      <NetworkWorkspace companyType="SHIPPER" connections={[pending]} follows={[]} preferences={new Map()} />,
    );
    await user.click(screen.getByRole("tab", { name: /requests/i }));
    expect(screen.getAllByText("Longhorn Transportation").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/action needed/i).length).toBeGreaterThan(0);
  });

  it("renders a carrier's Following list, private to the carrier", async () => {
    const user = userEvent.setup();
    const follow = buildCarrierFollowView({ shipperCompanyName: "Acme Manufacturing" });
    render(
      <NetworkWorkspace companyType="CARRIER" connections={[]} follows={[follow]} preferences={new Map()} />,
    );
    await user.click(screen.getByRole("tab", { name: /following/i }));
    expect(screen.getByText("Acme Manufacturing")).toBeInTheDocument();
  });

  it("shows a shipper's private preference on a connected carrier", () => {
    const accepted = buildConnectionView({ status: "ACCEPTED", counterpartCompanyId: "carrier-9" });
    const preferences = new Map([["carrier-9", "DO_NOT_PREFER" as const]]);
    render(
      <NetworkWorkspace companyType="SHIPPER" connections={[accepted]} follows={[]} preferences={preferences} />,
    );
    expect(screen.getAllByText("Do Not Prefer").length).toBeGreaterThan(0);
  });

  it("never shows a preference column for a carrier's own workspace", () => {
    const accepted = buildConnectionView({ status: "ACCEPTED" });
    render(
      <NetworkWorkspace companyType="CARRIER" connections={[accepted]} follows={[]} preferences={new Map()} />,
    );
    expect(screen.queryByText(/private preference/i)).not.toBeInTheDocument();
  });

  it("local search filters the Connected list by company name", async () => {
    const user = userEvent.setup();
    const a = buildConnectionView({ id: "c-a", status: "ACCEPTED", counterpartCompanyId: "co-a", counterpartCompanyName: "Longhorn Transportation" });
    const b = buildConnectionView({ id: "c-b", status: "ACCEPTED", counterpartCompanyId: "co-b", counterpartCompanyName: "Rio Grande Freight" });
    render(
      <NetworkWorkspace companyType="SHIPPER" connections={[a, b]} follows={[]} preferences={new Map()} />,
    );
    await user.type(screen.getByRole("searchbox", { name: /search carriers/i }), "Rio");
    expect(screen.queryByText("Longhorn Transportation")).not.toBeInTheDocument();
    expect(screen.getAllByText("Rio Grande Freight").length).toBeGreaterThan(0);
  });
});
