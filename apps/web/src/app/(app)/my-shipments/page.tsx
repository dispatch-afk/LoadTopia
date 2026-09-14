import Link from "next/link";
import type { Paginated, ShipmentListItem } from "@loadtopia/shared";
import { apiServer } from "@/lib/api-server";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { LoadStatusBadge } from "@/components/load-status-badge";
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
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Shipment</th>
                  <th className="px-4 py-2.5 font-medium">Lane</th>
                  <th className="px-4 py-2.5 font-medium">Shipper</th>
                  <th className="px-4 py-2.5 font-medium">Pickup</th>
                  <th className="px-4 py-2.5 font-medium">Delivery</th>
                  <th className="px-4 py-2.5 font-medium">Rate</th>
                  <th className="px-4 py-2.5 font-medium">Stage</th>
                  <th className="px-4 py-2.5 font-medium">Next action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {result.data.map((s) => (
                  <tr key={s.id} className="hover:bg-canvas">
                    <td className="whitespace-nowrap px-4 py-3 font-medium">
                      <Link href={`/marketplace/${s.id}`} className="text-brand-600 hover:underline">
                        {s.referenceNumber}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {s.origin.city}, {s.origin.state} → {s.destination.city}, {s.destination.state}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{s.shipperName}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">
                      {fmtWindow(s.pickupWindowStart, s.pickupWindowEnd)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">
                      {fmtWindow(s.deliveryWindowStart, s.deliveryWindowEnd)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium">
                      {fmtMoney(s.bookedRate)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <LoadStatusBadge status={s.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{s.nextAction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
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
