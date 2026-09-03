import Link from "next/link";
import { LoadStatus, type LoadListItem, type Paginated } from "@loadtopia/shared";
import { apiServer } from "@/lib/api-server";
import { Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { LoadStatusBadge } from "@/components/load-status-badge";
import { cn, fmtDate, fmtMiles, fmtWeight, fmtWindow, titleCase } from "@/lib/format";

const FILTERS = ["ALL", LoadStatus.DRAFT, LoadStatus.POSTED, LoadStatus.CANCELLED] as const;

export default async function LoadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const status: string =
    sp.status && FILTERS.includes(sp.status as never) ? sp.status : "ALL";
  const page = Math.max(1, Number(sp.page ?? "1") || 1);

  const result = await apiServer<Paginated<LoadListItem>>("/api/loads", {
    query: { page, pageSize: 20, status: status === "ALL" ? undefined : status },
  });

  return (
    <div>
      <PageHeader
        title="Loads"
        subtitle="Freight you manage. Private to your company."
        action={
          <Link href="/loads/new">
            <Button>+ New load</Button>
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "ALL" ? "/loads" : `/loads?status=${f}`}
            className={cn(
              "rounded-full border px-3 py-1 text-sm font-medium transition",
              status === f
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-line bg-white text-slate-600 hover:bg-brand-50",
            )}
          >
            {f === "ALL" ? "All" : titleCase(f)}
          </Link>
        ))}
      </div>

      {result.data.length === 0 ? (
        <EmptyState
          title={status === "ALL" ? "No loads yet" : `No ${titleCase(status)} loads`}
          description="Create a load to get started."
          action={
            <Link href="/loads/new">
              <Button>Create load</Button>
            </Link>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Load #</th>
                  <th className="px-4 py-2.5 font-medium">Lane</th>
                  <th className="px-4 py-2.5 font-medium">Pickup</th>
                  <th className="px-4 py-2.5 font-medium">Delivery</th>
                  <th className="px-4 py-2.5 font-medium">Equipment</th>
                  <th className="px-4 py-2.5 font-medium">Weight</th>
                  <th className="px-4 py-2.5 font-medium">Miles</th>
                  <th className="px-4 py-2.5 font-medium">Created</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {result.data.map((l) => (
                  <tr key={l.id} className="hover:bg-canvas">
                    <td className="whitespace-nowrap px-4 py-3 font-medium">
                      <Link href={`/loads/${l.id}`} className="text-brand-600 hover:underline">
                        {l.referenceNumber}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {l.origin.city}, {l.origin.state} → {l.destination.city}, {l.destination.state}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">
                      {fmtWindow(l.pickupWindowStart, l.pickupWindowEnd)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">
                      {fmtWindow(l.deliveryWindowStart, l.deliveryWindowEnd)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{titleCase(l.equipmentType)}</td>
                    <td className="whitespace-nowrap px-4 py-3">{fmtWeight(l.weightLbs)}</td>
                    <td className="whitespace-nowrap px-4 py-3">{fmtMiles(l.miles)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{fmtDate(l.createdAt)}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <LoadStatusBadge status={l.status} />
                    </td>
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
            Page {result.page} of {result.totalPages} · {result.total} loads
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/loads?${new URLSearchParams({ ...(status !== "ALL" ? { status } : {}), page: String(page - 1) })}`}
                className="rounded-lg border border-line bg-white px-3 py-1.5 hover:bg-canvas"
              >
                Previous
              </Link>
            )}
            {page < result.totalPages && (
              <Link
                href={`/loads?${new URLSearchParams({ ...(status !== "ALL" ? { status } : {}), page: String(page + 1) })}`}
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
