import Link from "next/link";
import { LoadStatus, type CoverageGroup, type Paginated, type LoadListItem } from "@loadtopia/shared";
import { apiServer } from "@/lib/api-server";
import { Badge, Button, EmptyState, PageHeader } from "@/components/ui";
import { LoadStatusBadge } from "@/components/load-status-badge";
import { LoadCard } from "@/components/loads/load-card";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/table";
import { audienceSummaryText, nextReleaseText } from "@/lib/audience";
import { cn, fmtMiles, fmtWeight, fmtWindow, titleCase } from "@/lib/format";

const GROUPS: { key: CoverageGroup | undefined; label: string }[] = [
  { key: undefined, label: "All" },
  { key: "DRAFT", label: "Drafts" },
  { key: "NEEDS_COVERAGE", label: "Needs Coverage" },
  { key: "COVERED", label: "Covered" },
];

const EMPTY_COPY: Record<"ALL" | CoverageGroup, { title: string; description: string }> = {
  ALL: { title: "No loads yet", description: "Create a load to get started." },
  DRAFT: { title: "No draft loads", description: "Drafts you start will appear here." },
  NEEDS_COVERAGE: {
    title: "No loads currently need coverage.",
    description: "Posted freight without a carrier assigned yet will appear here.",
  },
  COVERED: {
    title: "No covered freight yet.",
    description: "Loads with a carrier assigned will appear here.",
  },
};

function groupHref(key: CoverageGroup | undefined): string {
  return key ? `/loads?group=${key}` : "/loads";
}

export default async function LoadsPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const group: CoverageGroup | undefined = GROUPS.some((g) => g.key === sp.group)
    ? (sp.group as CoverageGroup)
    : undefined;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);

  const result = await apiServer<Paginated<LoadListItem>>("/api/loads", {
    query: { page, pageSize: 20, group },
  });

  const emptyCopy = EMPTY_COPY[group ?? "ALL"];

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
        {GROUPS.map((g) => (
          <Link
            key={g.label}
            href={groupHref(g.key)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm font-medium transition",
              group === g.key
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-line bg-white text-slate-600 hover:bg-brand-50",
            )}
          >
            {g.label}
          </Link>
        ))}
      </div>

      {result.data.length === 0 ? (
        <EmptyState
          title={emptyCopy.title}
          description={emptyCopy.description}
          action={
            !group ? (
              <Link href="/loads/new">
                <Button>Create load</Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Load #</TableHeaderCell>
                  <TableHeaderCell>Lane</TableHeaderCell>
                  <TableHeaderCell>Pickup</TableHeaderCell>
                  <TableHeaderCell>Delivery</TableHeaderCell>
                  <TableHeaderCell>Equipment</TableHeaderCell>
                  <TableHeaderCell>Weight</TableHeaderCell>
                  <TableHeaderCell>Miles</TableHeaderCell>
                  <TableHeaderCell>Audience</TableHeaderCell>
                  <TableHeaderCell>Next release</TableHeaderCell>
                  <TableHeaderCell>Offers</TableHeaderCell>
                  <TableHeaderCell>Next Action</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {result.data.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap font-medium">
                      <Link href={`/loads/${l.id}`} className="text-brand-600 hover:underline">
                        {l.referenceNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {l.origin.city}, {l.origin.state} → {l.destination.city}, {l.destination.state}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted">
                      {fmtWindow(l.pickupWindowStart, l.pickupWindowEnd)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted">
                      {fmtWindow(l.deliveryWindowStart, l.deliveryWindowEnd)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{titleCase(l.equipmentType)}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmtWeight(l.weightLbs)}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmtMiles(l.miles)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted">
                      {l.status === LoadStatus.DRAFT ? "—" : audienceSummaryText(l.audience)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted">
                      {l.status === LoadStatus.DRAFT || !l.audience
                        ? "—"
                        : nextReleaseText(l.audience.nextReleaseAt)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted">{l.activeOfferCount}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge tone="indigo">{l.commercialNextAction}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <LoadStatusBadge status={l.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="space-y-3 md:hidden">
            {result.data.map((l) => (
              <LoadCard key={l.id} l={l} />
            ))}
          </div>
        </>
      )}

      {result.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted">
          <span>
            Page {result.page} of {result.totalPages} · {result.total} loads
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/loads?${new URLSearchParams({ ...(group ? { group } : {}), page: String(page - 1) })}`}
                className="rounded-lg border border-line bg-white px-3 py-1.5 hover:bg-canvas"
              >
                Previous
              </Link>
            )}
            {page < result.totalPages && (
              <Link
                href={`/loads?${new URLSearchParams({ ...(group ? { group } : {}), page: String(page + 1) })}`}
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
