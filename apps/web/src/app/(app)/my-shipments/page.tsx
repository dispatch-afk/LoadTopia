import Link from "next/link";
import type { Paginated, ShipmentListItem } from "@loadtopia/shared";
import { apiServer } from "@/lib/api-server";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { LoadStatusBadge } from "@/components/load-status-badge";
import { CarrierShipmentCard } from "@/components/shipments/carrier-shipment-card";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/table";
import { fmtMoney, fmtWindow } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function MyShipmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);

  const result = await apiServer<Paginated<ShipmentListItem>>("/api/marketplace/shipments", {
    query: { page, pageSize: 20 },
  });

  return (
    <div>
      <PageHeader
        title="My Shipments"
        subtitle="Freight you've won — commercially agreed and moving."
      />

      {result.data.length === 0 ? (
        <EmptyState
          title="No shipments yet"
          description="Once you win a load — by accepted offer or Book at Posted Rate — it appears here."
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Shipment</TableHeaderCell>
                  <TableHeaderCell>Lane</TableHeaderCell>
                  <TableHeaderCell>Shipper</TableHeaderCell>
                  <TableHeaderCell>Pickup</TableHeaderCell>
                  <TableHeaderCell>Delivery</TableHeaderCell>
                  <TableHeaderCell>Rate</TableHeaderCell>
                  <TableHeaderCell>Stage</TableHeaderCell>
                  <TableHeaderCell>Next action</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {result.data.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap font-medium">
                      <Link href={`/marketplace/${s.id}`} className="text-brand-600 hover:underline">
                        {s.referenceNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {s.origin.city}, {s.origin.state} → {s.destination.city}, {s.destination.state}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted">{s.shipperName}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted">
                      {fmtWindow(s.pickupWindowStart, s.pickupWindowEnd)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted">
                      {fmtWindow(s.deliveryWindowStart, s.deliveryWindowEnd)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-medium">{fmtMoney(s.bookedRate)}</TableCell>
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
              <CarrierShipmentCard key={s.id} s={s} />
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
                href={`/my-shipments?page=${page - 1}`}
                className="rounded-lg border border-line bg-white px-3 py-1.5 hover:bg-canvas"
              >
                Previous
              </Link>
            )}
            {page < result.totalPages && (
              <Link
                href={`/my-shipments?page=${page + 1}`}
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
