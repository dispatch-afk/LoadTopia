// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildRateConfirmationView } from "@/test/fixtures";
import { RateConfirmationPanel } from "./rate-confirmation-panel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("RateConfirmationPanel", () => {
  it("shows 'Booked at posted rate' for a POSTED_RATE_BOOKING agreement", () => {
    render(
      <RateConfirmationPanel
        loadId="load-1"
        state={buildRateConfirmationView({ agreementSource: "POSTED_RATE_BOOKING" })}
      />,
    );
    expect(screen.getByText("Booked at posted rate")).toBeInTheDocument();
  });

  it("shows 'Negotiated offer' for a CARRIER_OFFER agreement", () => {
    render(
      <RateConfirmationPanel
        loadId="load-1"
        state={buildRateConfirmationView({ agreementSource: "CARRIER_OFFER" })}
      />,
    );
    expect(screen.getByText("Negotiated offer")).toBeInTheDocument();
  });

  it("never fabricates a snapshot for a historical load — shows the truthful unavailable state", () => {
    render(<RateConfirmationPanel loadId="load-1" state="unavailable" />);
    expect(screen.getByText(/not available for this load/i)).toBeInTheDocument();
    expect(screen.queryByText("Booked at posted rate")).not.toBeInTheDocument();
    expect(screen.queryByText("Negotiated offer")).not.toBeInTheDocument();
  });

  it("shows the pending-generation notice when no download exists yet, without implying the agreement itself is at risk", () => {
    render(
      <RateConfirmationPanel
        loadId="load-1"
        state={buildRateConfirmationView({ download: null, documentPending: true })}
      />,
    );
    expect(screen.getByText(/being prepared/i)).toBeInTheDocument();
    expect(screen.getByText(/already in effect/i)).toBeInTheDocument();
  });
});
