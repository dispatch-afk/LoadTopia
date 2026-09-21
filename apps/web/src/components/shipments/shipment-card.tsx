import Link from "next/link";
import type { ShipmentListItem } from "@loadtopia/shared";
import { Badge } from "@/components/ui";
import { LoadStatusBadge } from "@/components/load-status-badge";
import { fmtMoney, fmtWindow } from "@/lib/format";

/**
 * Mobile card representation of a shipper Shipments-workspace row (Milestone
 * 4 Phase 12) — the `md:hidden` counterpart to the desktop table. Renders
 * only server-provided facts: `nextAction` (shipmentNextAction) is shown
 * verbatim, never re-derived from `status` here. Links into the existing,
 * unified `/loads/:id` Shipment Detail — no separate route.
 */
export function ShipmentCard({ s }: { s: ShipmentListItem }) {
  return (
    <Link
      href={`/loads/${s.id}`}
      className="block rounded-xl border border-line bg-white p-4 hover:border-brand-200"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-brand-600">{s.referenceNumber}</span>
        <LoadStatusBadge status={s.status} />
      </div>
      <p className="mt-1 text-sm text-ink">
        {s.origin.city}, {s.origin.state} → {s.destination.city}, {s.destination.state}
      </p>
      <p className="mt-1 text-xs text-muted">
        {s.carrierName ?? "—"}
        {s.bookedRate && <> · {fmtMoney(s.bookedRate)}</>}
      </p>
      <p className="text-xs text-muted">Pickup: {fmtWindow(s.pickupWindowStart, s.pickupWindowEnd)}</p>
      <p className="text-xs text-muted">Delivery: {fmtWindow(s.deliveryWindowStart, s.deliveryWindowEnd)}</p>
      <p className="mt-2">
        <Badge tone="indigo">{s.nextAction}</Badge>
      </p>
    </Link>
  );
}
