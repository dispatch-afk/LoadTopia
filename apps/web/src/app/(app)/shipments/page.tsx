import Link from "next/link";
import type { Paginated, ShipmentListItem } from "@loadtopia/shared";
import { apiServer } from "@/lib/api-server";
import { requireMe } from "@/lib/session";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { FacilityScopeBanner } from "@/components/facility-scope-banner";
import { LoadStatusBadge } from "@/components/load-status-badge";
import { ShipmentCard } from "@/components/shipments/shipment-card";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/table";
import { fmtMoney, fmtWindow } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ShipmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);

  const me = await requireMe();
  const result = await apiServer<Paginated<ShipmentListItem>>("/api/loads/shipments", {
    query: { page, pageSize: 20 },
  });

  return (
    <div>
      <FacilityScopeBanner scoped={me.facilityScoped} />
      <PageHeader
        title="Shipments"
        subtitle="Freight you've covered — commercially agreed and moving. Private to your company."
      />

      {result.data.length === 0 ? (
        <EmptyState
          title="No shipments yet"
          description="Once a load is awarded to a carrier, it appears here."
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Shipment</TableHeaderCell>
                  <TableHeaderCell>Lane</TableHeaderCell>
                  <TableHeaderCell>Carrier</TableHeaderCell>
                  <TableHeaderCell>Pickup</TableHeaderCell>
                  <TableHeaderCell>Delivery</TableHeaderCell>
                  <TableHeaderCell>Stage</TableHeaderCell>
                  <TableHeaderCell>Next action</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {result.data.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap font-medium">
                      <Link href={`/loads/${s.id}`} className="text-brand-600 hover:underline">
                        {s.referenceNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {s.origin.city}, {s.origin.state} → {s.destination.city}, {s.destination.state}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted">
                      {s.carrierName ?? "—"}
                      {s.bookedRate && <span className="ml-1.5">· {fmtMoney(s.bookedRate)}</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted">
                      {fmtWindow(s.pickupWindowStart, s.pickupWindowEnd)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted">
                      {fmtWindow(s.deliveryWindowStart, s.deliveryWindowEnd)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <LoadStatusBadge status={s.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge tone="indigo">{s.nextAction}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="space-y-3 md:hidden">
            {result.data.map((s) => (
              <ShipmentCard key={s.id} s={s} />
            ))}
          </div>
        </>
      )}

      {result.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted">
          <span>
            Page {result.page} of {result.totalPages} · {result.total} shipments
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/shipments?page=${page - 1}`}
                className="rounded-lg border border-line bg-white px-3 py-1.5 hover:bg-canvas"
              >
                Previous
              </Link>
            )}
            {page < result.totalPages && (
              <Link
                href={`/shipments?page=${page + 1}`}
                className="rounded-lg border border-line bg-white px-3 py-1.5 hover:bg-canvas"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
