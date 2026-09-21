import Link from "next/link";
import type { OfferThreadSummary } from "@loadtopia/shared";
import { Badge } from "@/components/ui";
import { fmtDateTime, fmtMoney, titleCase } from "@/lib/format";
import { OFFER_THREAD_STATUS_TONE } from "@/lib/status-tone";

/** True only when it is genuinely this carrier's turn to respond — reuses
 *  the server-computed `awaitingMyResponse` verbatim; never a second
 *  algorithm, never derived from round parity or timestamps. */
export function isMyOfferMove(t: OfferThreadSummary): boolean {
  return t.status === "ACTIVE" && t.awaitingMyResponse === true;
}

/**
 * Mobile card representation of a My Offers row (Milestone 4 Phase 12) —
 * the `md:hidden` counterpart to the desktop table. Shows only this
 * carrier's own thread facts (its own current amount, its own thread
 * status) plus the load identity/lane now carried on `OfferThreadSummary`.
 * Never renders a winner, a competing amount, or any Rate Confirmation
 * data — none of that exists on this type. Links into the existing
 * `/marketplace/:id` route, which resolves to the shared operational
 * Shipment Detail once won, or Milestone 4 Phase 9's truthful "Load
 * Covered" history once lost — unchanged by this component.
 */
export function OfferCard({ t }: { t: OfferThreadSummary }) {
  const yourMove = isMyOfferMove(t);
  return (
    <Link
      href={`/marketplace/${t.loadId}`}
      className="block rounded-xl border border-line bg-white p-4 hover:border-brand-200"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-brand-600">{t.load.referenceNumber}</span>
        {yourMove && <Badge tone="indigo">Your move</Badge>}
      </div>
      <p className="mt-1 text-sm text-ink">
        {t.load.origin.city}, {t.load.origin.state} → {t.load.destination.city}, {t.load.destination.state}
      </p>
      <p className="mt-1 text-xs text-muted">
        {fmtMoney(t.currentAmount, t.currentCurrency)} · {t.roundCount} round{t.roundCount === 1 ? "" : "s"}
      </p>
      <p className="text-xs text-muted">Updated {fmtDateTime(t.updatedAt)}</p>
      {!yourMove && (
        <p className="mt-2">
          <Badge tone={OFFER_THREAD_STATUS_TONE[t.status]}>{titleCase(t.status)}</Badge>
        </p>
      )}
    </Link>
  );
}
