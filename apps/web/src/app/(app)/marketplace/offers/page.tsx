import Link from "next/link";
import type { OfferThreadSummary, Paginated } from "@loadtopia/shared";
import { apiServer } from "@/lib/api-server";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { OfferCard, isMyOfferMove } from "@/components/marketplace/offer-card";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/table";
import { fmtDateTime, fmtMoney, titleCase } from "@/lib/format";
import { OFFER_THREAD_STATUS_TONE } from "@/lib/status-tone";

export const dynamic = "force-dynamic";

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
        <>
          <div className="hidden md:block">
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Load</TableHeaderCell>
                  <TableHeaderCell>Lane</TableHeaderCell>
                  <TableHeaderCell>Current amount</TableHeaderCell>
                  <TableHeaderCell>Rounds</TableHeaderCell>
                  <TableHeaderCell>Updated</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {result.data.map((t) => (
                  <TableRow key={t.threadId}>
                    <TableCell className="whitespace-nowrap font-medium">
                      <Link href={`/marketplace/${t.loadId}`} className="text-brand-600 hover:underline">
                        {t.load.referenceNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {t.load.origin.city}, {t.load.origin.state} → {t.load.destination.city},{" "}
                      {t.load.destination.state}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {fmtMoney(t.currentAmount, t.currentCurrency)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted">{t.roundCount}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted">{fmtDateTime(t.updatedAt)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge tone={OFFER_THREAD_STATUS_TONE[t.status]}>{titleCase(t.status)}</Badge>
                      {isMyOfferMove(t) && (
                        <span className="ml-1">
                          <Badge tone="indigo">Your move</Badge>
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="space-y-3 md:hidden">
            {result.data.map((t) => (
              <OfferCard key={t.threadId} t={t} />
            ))}
          </div>
        </>
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
