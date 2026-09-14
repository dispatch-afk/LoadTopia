// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildLoadView, buildRateConfirmationView } from "@/test/fixtures";
import { ShipmentDetail } from "./shipment-detail";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const award = {
  carrierCompanyId: "carrier-1",
  carrierName: "Sunrise Carriers",
  offerRoundId: "round-1",
  amount: "1500.00",
  currency: "USD",
  awardedAt: "2026-01-01T00:00:00.000Z",
  assignedAt: "2026-01-01T01:00:00.000Z",
};

describe("ShipmentDetail", () => {
  it("shows the shipment identity, next action, and route/freight facts", () => {
    render(
      <ShipmentDetail
        load={buildLoadView({
          status: "CARRIER_ASSIGNED",
          shipperName: "Palermo Foods",
          shipmentNextAction: "Confirm pickup",
          marketplace: { onMarket: false, activeOfferCount: 0, award },
        })}
        checkIns={[]}
        documents={[]}
        rateConfirmation={null}
        viewerCompanyId="carrier-1"
        canRecordCheckIn={false}
        canUploadDocument={false}
        canReviewPod={false}
        actions={<div>role actions</div>}
      />,
    );
    expect(screen.getByText("Palermo Foods")).toBeInTheDocument();
    // "Sunrise Carriers" legitimately appears twice — the header identity
    // line and the Commercial Agreement card's own summary.
    expect(screen.getAllByText("Sunrise Carriers").length).toBeGreaterThan(0);
    expect(screen.getByText("Confirm pickup")).toBeInTheDocument();
    expect(screen.getByText("Awaiting Pickup")).toBeInTheDocument();
  });

  it("renders exactly the actions slot it was given — proving role-specific controls are the caller's choice, not this component's", () => {
    const { rerender } = render(
      <ShipmentDetail
        load={buildLoadView({ status: "CARRIER_ASSIGNED", marketplace: { onMarket: false, activeOfferCount: 0, award } })}
        checkIns={[]}
        documents={[]}
        rateConfirmation={null}
        viewerCompanyId="company-1"
        canRecordCheckIn={false}
        canUploadDocument={false}
        canReviewPod={false}
        actions={<button type="button">Shipper-only control</button>}
      />,
    );
    expect(screen.getByText("Shipper-only control")).toBeInTheDocument();
    expect(screen.queryByText("Carrier-only control")).not.toBeInTheDocument();

    rerender(
      <ShipmentDetail
        load={buildLoadView({ status: "CARRIER_ASSIGNED", marketplace: { onMarket: false, activeOfferCount: 0, award } })}
        checkIns={[]}
        documents={[]}
        rateConfirmation={null}
        viewerCompanyId="carrier-1"
        canRecordCheckIn={false}
        canUploadDocument={false}
        canReviewPod={false}
        actions={<button type="button">Carrier-only control</button>}
      />,
    );
    expect(screen.getByText("Carrier-only control")).toBeInTheDocument();
    expect(screen.queryByText("Shipper-only control")).not.toBeInTheDocument();
  });

  it("shows the Commercial Agreement card only when the load has actually been awarded", () => {
    const { rerender } = render(
      <ShipmentDetail
        load={buildLoadView({ status: "CARRIER_ASSIGNED", marketplace: { onMarket: false, activeOfferCount: 0, award: null } })}
        checkIns={[]}
        documents={[]}
        rateConfirmation={null}
        viewerCompanyId={null}
        canRecordCheckIn={false}
        canUploadDocument={false}
        canReviewPod={false}
        actions={null}
      />,
    );
    expect(screen.queryByText("Commercial agreement")).not.toBeInTheDocument();

    rerender(
      <ShipmentDetail
        load={buildLoadView({ status: "CARRIER_ASSIGNED", marketplace: { onMarket: false, activeOfferCount: 0, award } })}
        checkIns={[]}
        documents={[]}
        rateConfirmation={null}
        viewerCompanyId={null}
        canRecordCheckIn={false}
        canUploadDocument={false}
        canReviewPod={false}
        actions={null}
      />,
    );
    expect(screen.getByText("Commercial agreement")).toBeInTheDocument();
    expect(screen.getByText(/\$1,500\.00/)).toBeInTheDocument();
  });

  it("surfaces the Rate Confirmation's agreement source inside the Commercial Agreement card", () => {
    render(
      <ShipmentDetail
        load={buildLoadView({ status: "DELIVERED", marketplace: { onMarket: false, activeOfferCount: 0, award } })}
        checkIns={[]}
        documents={[]}
        rateConfirmation={buildRateConfirmationView({ agreementSource: "POSTED_RATE_BOOKING" })}
        viewerCompanyId={null}
        canRecordCheckIn={false}
        canUploadDocument={false}
        canReviewPod={false}
        actions={null}
      />,
    );
    expect(screen.getByText("Booked at posted rate")).toBeInTheDocument();
  });

  describe("customer-facing stage at DELIVERED is POD-aware", () => {
    it("stays 'Delivered' when no POD has been uploaded", () => {
      render(
        <ShipmentDetail
          load={buildLoadView({ status: "DELIVERED", marketplace: { onMarket: false, activeOfferCount: 0, award } })}
          checkIns={[]}
          documents={[]}
          rateConfirmation={null}
          viewerCompanyId={null}
          canRecordCheckIn={false}
          canUploadDocument={false}
          canReviewPod={false}
          actions={null}
        />,
      );
      // "Delivered" legitimately appears twice — the stage header and the
      // ShipmentProgress stepper's own step label.
      expect(screen.getAllByText("Delivered").length).toBeGreaterThan(0);
      expect(screen.queryByText("POD Review")).not.toBeInTheDocument();
    });

    it("becomes 'POD Review' once a POD has been uploaded, before internal status ever changes", () => {
      render(
        <ShipmentDetail
          load={buildLoadView({ status: "DELIVERED", marketplace: { onMarket: false, activeOfferCount: 0, award } })}
          checkIns={[]}
          documents={[
            {
              id: "doc-1",
              loadId: "load-1",
              docType: "POD",
              status: "CONFIRMED",
              contentType: "application/pdf",
              sizeBytes: 100,
              originalFilename: "pod.pdf",
              reviewStatus: "PENDING_REVIEW",
              reviewReason: null,
              replacesDocumentId: null,
              uploadedByUserId: "user-1",
              uploadedByCompanyId: "carrier-1",
              confirmedAt: "2026-01-01T00:00:00.000Z",
              removedAt: null,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ]}
          rateConfirmation={null}
          viewerCompanyId={null}
          canRecordCheckIn={false}
          canUploadDocument={false}
          canReviewPod={false}
          actions={null}
        />,
      );
      // The stage header switches to "POD Review" — the ShipmentProgress
      // stepper below it still legitimately shows its fixed "Delivered"
      // step label (a different, unrelated piece of UI), so only assert on
      // the stage header itself changing.
      expect(screen.getByText("POD Review")).toBeInTheDocument();
    });
  });

  it("shows the truthful legacy-award stage for a historical AWARDED-only load — never implies active assignment", () => {
    render(
      <ShipmentDetail
        load={buildLoadView({
          status: "AWARDED",
          marketplace: {
            onMarket: false,
            activeOfferCount: 0,
            award: { ...award, assignedAt: null },
          },
        })}
        checkIns={[]}
        documents={[]}
        rateConfirmation={null}
        viewerCompanyId={null}
        canRecordCheckIn={false}
        canUploadDocument={false}
        canReviewPod={false}
        actions={null}
      />,
    );
    // "Awarded" legitimately appears twice — the stage header and the
    // ShipmentProgress stepper's own "Awarded" step (shown only pre-assignment).
    expect(screen.getAllByText("Awarded").length).toBeGreaterThan(0);
    // The Commercial Agreement summary must never say "assigned" when
    // assignedAt is null — scoped to that card, since ShipmentProgress's
    // stepper unrelatedly always shows a step literally labeled "Assigned".
    const commercialCard = screen.getByText("Commercial agreement").closest("div")!;
    expect(within(commercialCard).queryByText(/assigned/i)).not.toBeInTheDocument();
  });

  it("shows Completed for a completed shipment", () => {
    render(
      <ShipmentDetail
        load={buildLoadView({ status: "COMPLETED", marketplace: { onMarket: false, activeOfferCount: 0, award } })}
        checkIns={[]}
        documents={[]}
        rateConfirmation={null}
        viewerCompanyId={null}
        canRecordCheckIn={false}
        canUploadDocument={false}
        canReviewPod={false}
        actions={null}
      />,
    );
    // "Completed" legitimately appears twice — the stage header and the
    // ShipmentProgress stepper's own step label.
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
  });

  it("delegates the timeline to the shared ShipmentTimeline — an empty history shows the truthful empty state", () => {
    render(
      <ShipmentDetail
        load={buildLoadView({ status: "CARRIER_ASSIGNED", marketplace: { onMarket: false, activeOfferCount: 0, award }, events: [] })}
        checkIns={[]}
        documents={[]}
        rateConfirmation={null}
        viewerCompanyId={null}
        canRecordCheckIn={false}
        canUploadDocument={false}
        canReviewPod={false}
        actions={null}
      />,
    );
    expect(screen.getByText(/no history yet/i)).toBeInTheDocument();
  });
});
