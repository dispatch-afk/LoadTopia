import Link from "next/link";
import type { MarketplaceLoadListItem } from "@loadtopia/shared";
import { Badge } from "@/components/ui";
import { fmtMiles, fmtMoney, fmtWindow, titleCase } from "@/lib/format";

/** True only when this carrier's own thread is ACTIVE and it is genuinely
 *  their turn to respond — reuses the server-computed `awaitingMyResponse`
 *  (itself built on `respondingParty`) verbatim; never a second algorithm. */
export function isYourMove(l: MarketplaceLoadListItem): boolean {
  return l.myThread?.status === "ACTIVE" && l.myThread.awaitingMyResponse === true;
}

/**
 * Mobile card representation of a Find Freight row (Milestone 4 Phase 10).
 * Rate/RPM are rendered exactly as already computed server-side — no
 * PricingProvider, no market comparison, no phantom labels.
 */
export function MarketplaceCard({ l }: { l: MarketplaceLoadListItem }) {
  const yourMove = isYourMove(l);
  return (
    <Link
      href={`/marketplace/${l.id}`}
      className="block rounded-xl border border-line bg-white p-4 hover:border-brand-200"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-brand-600">{l.referenceNumber}</span>
        {yourMove && <Badge tone="indigo">Your move</Badge>}
      </div>
      <p className="mt-1 text-sm text-ink">
        {l.origin.city}, {l.origin.state} → {l.destination.city}, {l.destination.state}
      </p>
      <p className="mt-1 text-xs text-muted">Pickup: {fmtWindow(l.pickupWindowStart, l.pickupWindowEnd)}</p>
      <p className="text-xs text-muted">
        {titleCase(l.equipmentType)} · {fmtMiles(l.miles)}
      </p>
      <p className="text-xs text-muted">
        {l.commercialMode === "PUBLISH_RATE" && l.postedRate ? (
          <>
            {fmtMoney(l.postedRate)}
            {l.ratePerMile && <> · ${l.ratePerMile}/mi</>}
          </>
        ) : (
          "Requesting offers"
        )}
      </p>
      <div className="mt-2 flex items-center gap-1.5">
        {l.shipperIsConnected && <Badge tone="indigo">Connected</Badge>}
        {l.myThread && !yourMove && (
          <Badge tone={l.myThread.status === "ACTIVE" ? "amber" : "gray"}>
            {titleCase(l.myThread.status)}
          </Badge>
        )}
      </div>
    </Link>
  );
}
