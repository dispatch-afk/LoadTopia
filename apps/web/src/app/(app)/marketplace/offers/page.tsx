import Link from "next/link";
import type { OfferThreadSummary, Paginated } from "@loadtopia/shared";
import { apiServer } from "@/lib/api-server";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { fmtDateTime, titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";

const TONE: Record<string, "gray" | "green" | "amber" | "red" | "indigo"> = {
  ACTIVE: "amber",
  ACCEPTED: "green",
  REJECTED: "red",
  WITHDRAWN: "gray",
  EXPIRED: "gray",
};

function money(v: string | null, currency = "USD") {
  return v == null ? "—" : new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(v));
}

export default async function MyOffersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const result = await apiServer<Paginated<OfferThreadSummary>>("/api/offers", {
    query: { page, pageSize: 20 },
  });

  return (
    <div>
      <PageHeader title="My Offers" subtitle="Every negotiation your company has opened." />

      {result.data.length === 0 ? (
        <EmptyState
          title="No offers yet"
          description="Find freight on the marketplace and submit an offer."
          action={
            <Link href="/marketplace" className="text-sm font-medium text-brand-600 hover:underline">
              Browse the marketplace →
            </Link>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Load</th>
                  <th className="px-4 py-2.5 font-medium">Current amount</th>
                  <th className="px-4 py-2.5 font-medium">Rounds</th>
                  <th className="px-4 py-2.5 font-medium">Updated</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {result.data.map((t) => (
                  <tr key={t.threadId} className="hover:bg-canvas">
                    <td className="whitespace-nowrap px-4 py-3 font-medium">
                      <Link
                        href={`/marketplace/${t.loadId}`}
                        className="text-brand-600 hover:underline"
                      >
                        View load
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {money(t.currentAmount, t.currentCurrency)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{t.roundCount}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">
                      {fmtDateTime(t.updatedAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Badge tone={TONE[t.status] ?? "gray"}>{titleCase(t.status)}</Badge>
                      {t.awaitingMyResponse && t.status === "ACTIVE" && (
                        <span className="ml-1">
                          <Badge tone="indigo">Your move</Badge>
                        </span>
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
            Page {result.page} of {result.totalPages} · {result.total}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/marketplace/offers?page=${page - 1}`}
                className="rounded-lg border border-line bg-white px-3 py-1.5 hover:bg-canvas"
              >
                Previous
              </Link>
            )}
            {page < result.totalPages && (
              <Link
                href={`/marketplace/offers?page=${page + 1}`}
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
