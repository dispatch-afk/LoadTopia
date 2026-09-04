import Link from "next/link";
import type { MarketplaceLoadListItem, Paginated } from "@loadtopia/shared";
import { ApiError, apiServer } from "@/lib/api-server";
import { Alert, Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { fmtDate, fmtMiles, fmtWeight, fmtWindow, titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";

const SORTS = [
  { key: "newest", label: "Newest" },
  { key: "pickup", label: "Pickup date" },
  { key: "miles", label: "Distance" },
] as const;

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const sort = SORTS.some((s) => s.key === sp.sort) ? sp.sort! : "newest";

  let result: Paginated<MarketplaceLoadListItem>;
  try {
    result = await apiServer<Paginated<MarketplaceLoadListItem>>("/api/marketplace/loads", {
      query: { page, pageSize: 20, sort },
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      return (
        <div>
          <PageHeader title="Marketplace" subtitle="Available freight" />
          <Alert tone="info">
            Your company is not yet eligible to browse the marketplace. Complete your{" "}
            <Link href="/settings/carrier-profile" className="font-medium underline">
              carrier profile
            </Link>{" "}
            and run verification, or wait for a LoadTopia review.
          </Alert>
        </div>
      );
    }
    throw err;
  }

  return (
    <div>
      <PageHeader
        title="Marketplace"
        subtitle="Freight matched to your equipment and service area. Server-filtered."
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {SORTS.map((s) => (
          <Link
            key={s.key}
            href={`/marketplace?sort=${s.key}`}
            className={
              "rounded-full border px-3 py-1 text-sm font-medium transition " +
              (sort === s.key
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-line bg-white text-slate-600 hover:bg-brand-50")
            }
          >
            {s.label}
          </Link>
        ))}
      </div>

      {result.data.length === 0 ? (
        <EmptyState
          title="No matching loads"
          description="Nothing on the board matches your carrier profile right now. Check back soon."
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Ref</th>
                  <th className="px-4 py-2.5 font-medium">Lane</th>
                  <th className="px-4 py-2.5 font-medium">Pickup</th>
                  <th className="px-4 py-2.5 font-medium">Equipment</th>
                  <th className="px-4 py-2.5 font-medium">Weight</th>
                  <th className="px-4 py-2.5 font-medium">Miles</th>
                  <th className="px-4 py-2.5 font-medium">Shipper</th>
                  <th className="px-4 py-2.5 font-medium">Posted</th>
                  <th className="px-4 py-2.5 font-medium">My offer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {result.data.map((l) => (
                  <tr key={l.id} className="hover:bg-canvas">
                    <td className="whitespace-nowrap px-4 py-3 font-medium">
                      <Link href={`/marketplace/${l.id}`} className="text-brand-600 hover:underline">
                        {l.referenceNumber}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {l.origin.city}, {l.origin.state} → {l.destination.city}, {l.destination.state}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">
                      {fmtWindow(l.pickupWindowStart, l.pickupWindowEnd)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{titleCase(l.equipmentType)}</td>
                    <td className="whitespace-nowrap px-4 py-3">{fmtWeight(l.weightLbs)}</td>
                    <td className="whitespace-nowrap px-4 py-3">{fmtMiles(l.miles)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{l.shipperName}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{fmtDate(l.postedAt)}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {l.myThread ? (
                        <Badge tone={l.myThread.status === "ACTIVE" ? "amber" : "gray"}>
                          {titleCase(l.myThread.status)}
                        </Badge>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
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
                href={`/marketplace?sort=${sort}&page=${page - 1}`}
                className="rounded-lg border border-line bg-white px-3 py-1.5 hover:bg-canvas"
              >
                Previous
              </Link>
            )}
            {page < result.totalPages && (
              <Link
                href={`/marketplace?sort=${sort}&page=${page + 1}`}
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
