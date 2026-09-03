import Link from "next/link";
import type { EquipmentView, LoadListItem, LocationView, Paginated } from "@loadtopia/shared";
import { apiServer } from "@/lib/api-server";
import { requireMe, activeMembership } from "@/lib/session";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { LoadStatusBadge } from "@/components/load-status-badge";
import { fmtDate, fmtMiles } from "@/lib/format";

async function count(path: string): Promise<number> {
  const r = await apiServer<Paginated<unknown>>(path, { query: { pageSize: 1 } });
  return r.total;
}

export default async function DashboardPage() {
  const me = await requireMe();
  const membership = activeMembership(me);

  const [recent, loadTotal, draftTotal, postedTotal, locTotal, eqTotal] = await Promise.all([
    apiServer<Paginated<LoadListItem>>("/api/loads", { query: { pageSize: 6 } }),
    count("/api/loads"),
    count("/api/loads?status=DRAFT"),
    count("/api/loads?status=POSTED"),
    apiServer<Paginated<LocationView>>("/api/locations", { query: { pageSize: 1 } }).then((r) => r.total),
    apiServer<Paginated<EquipmentView>>("/api/equipment", { query: { pageSize: 1 } }).then((r) => r.total),
  ]);

  const stats = [
    { label: "Loads", value: loadTotal, href: "/loads" },
    { label: "Draft", value: draftTotal, href: "/loads?status=DRAFT" },
    { label: "Posted", value: postedTotal, href: "/loads?status=POSTED" },
    { label: "Locations", value: locTotal, href: "/locations" },
    { label: "Equipment", value: eqTotal, href: "/equipment" },
  ];

  return (
    <div>
      <PageHeader
        title={`Welcome, ${me.user.firstName}`}
        subtitle={membership ? `${membership.companyName} · ${membership.role}` : undefined}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card className="p-4 transition hover:border-brand-200">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">{s.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</p>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Recent loads</h2>
          <Link href="/loads" className="text-sm font-medium text-brand-600 hover:underline">
            View all
          </Link>
        </div>
        {recent.data.length === 0 ? (
          <EmptyState
            title="No loads yet"
            description="Create your first load to start managing freight."
            action={
              <Link
                href="/loads/new"
                className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                Create load
              </Link>
            }
          />
        ) : (
          <Card className="divide-y divide-line">
            {recent.data.map((l) => (
              <Link
                key={l.id}
                href={`/loads/${l.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-canvas"
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink">{l.referenceNumber}</p>
                  <p className="truncate text-sm text-muted">
                    {l.origin.city}, {l.origin.state} → {l.destination.city}, {l.destination.state}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-4 text-sm text-muted">
                  <span className="hidden sm:inline">{fmtMiles(l.miles)}</span>
                  <span className="hidden sm:inline">{fmtDate(l.createdAt)}</span>
                  <LoadStatusBadge status={l.status} />
                </div>
              </Link>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}
