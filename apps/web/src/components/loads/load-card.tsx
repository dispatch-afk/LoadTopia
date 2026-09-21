import Link from "next/link";
import { LoadStatus, type LoadListItem } from "@loadtopia/shared";
import { Badge } from "@/components/ui";
import { LoadStatusBadge } from "@/components/load-status-badge";
import { audienceSummaryText } from "@/lib/audience";
import { fmtWindow, titleCase } from "@/lib/format";

/**
 * Mobile card representation of a Loads-workspace row (Milestone 4 Phase
 * 10) — the `md:hidden` counterpart to the desktop table. Renders only
 * server-provided facts: `commercialNextAction` is displayed verbatim,
 * never independently re-derived from `status` here.
 */
export function LoadCard({ l }: { l: LoadListItem }) {
  return (
    <Link
      href={`/loads/${l.id}`}
      className="block rounded-xl border border-line bg-white p-4 hover:border-brand-200"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-brand-600">{l.referenceNumber}</span>
        <LoadStatusBadge status={l.status} />
      </div>
      <p className="mt-1 text-sm text-ink">
        {l.origin.city}, {l.origin.state} → {l.destination.city}, {l.destination.state}
      </p>
      <p className="mt-1 text-xs text-muted">Pickup: {fmtWindow(l.pickupWindowStart, l.pickupWindowEnd)}</p>
      <p className="text-xs text-muted">{titleCase(l.equipmentType)}</p>
      {l.status !== LoadStatus.DRAFT && (
        <p className="text-xs text-muted">
          {audienceSummaryText(l.audience)} · {l.activeOfferCount} offer
          {l.activeOfferCount === 1 ? "" : "s"}
        </p>
      )}
      <p className="mt-2">
        <Badge tone="indigo">{l.commercialNextAction}</Badge>
      </p>
    </Link>
  );
}
