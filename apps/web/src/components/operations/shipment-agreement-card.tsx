import type { LoadMarketplaceView, RateConfirmationView } from "@loadtopia/shared";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { RateConfirmationPanel } from "./rate-confirmation-panel";

/**
 * The commercial-agreement summary for an operational shipment — booked USD
 * rate, award/assignment timestamps, and (when available) the Rate
 * Confirmation. Consolidates what were previously two separately-hand-rolled
 * cards (the shipper page's award banner and the carrier page's "Booking"
 * card, Milestone 4 Phase 6) into one shared, role-agnostic component.
 */
export function ShipmentAgreementCard({
  loadId,
  award,
  rateConfirmation,
}: {
  loadId: string;
  award: NonNullable<LoadMarketplaceView["award"]>;
  rateConfirmation: RateConfirmationView | "unavailable" | null;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-ink">
          Booked at <span className="font-semibold">{fmtMoney(award.amount, award.currency)}</span>{" "}
          with <span className="font-medium">{award.carrierName}</span>
        </p>
        <p className="mt-1 text-xs text-muted">
          Awarded {fmtDateTime(award.awardedAt)}
          {award.assignedAt ? ` · assigned ${fmtDateTime(award.assignedAt)}` : ""}
        </p>
      </div>

      {rateConfirmation !== null && (
        <div className="border-t border-line pt-4">
          <h3 className="mb-3 text-sm font-semibold text-ink">Rate Confirmation</h3>
          <RateConfirmationPanel loadId={loadId} state={rateConfirmation} />
        </div>
      )}
    </div>
  );
}
