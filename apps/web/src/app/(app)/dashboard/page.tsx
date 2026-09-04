import Link from "next/link";
import type {
  CarrierProfileView,
  EquipmentView,
  LoadListItem,
  LocationView,
  OfferThreadSummary,
  Paginated,
} from "@loadtopia/shared";
import { ApiError, apiServer } from "@/lib/api-server";
import { requireMe, activeMembership, can } from "@/lib/session";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { LoadStatusBadge } from "@/components/load-status-badge";
import { fmtDate, fmtDateTime, fmtMiles, titleCase } from "@/lib/format";

async function count(path: string): Promise<number> {
  const r = await apiServer<Paginated<unknown>>(path, { query: { pageSize: 1 } });
  return r.total;
}

/** Resolve to a fallback instead of throwing — for endpoints that legitimately
 *  403 depending on state (e.g. the marketplace board for a not-yet-eligible
 *  carrier). Keeps the dashboard out of the global error boundary. */
async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) return fallback;
    throw err;
  }
}

const THREAD_TONE: Record<string, "gray" | "green" | "amber" | "red" | "indigo"> = {
  ACTIVE: "amber",
  ACCEPTED: "green",
  REJECTED: "red",
  WITHDRAWN: "gray",
  EXPIRED: "gray",
};

function money(v: string | null, currency = "USD") {
  return v == null
    ? "—"
    : new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(v));
}

export default async function DashboardPage() {
  const me = await requireMe();
  const membership = activeMembership(me);
  const subtitle = membership ? `${membership.companyName} · ${membership.role}` : undefined;

  // Carriers do NOT have `load:read:own` — they must never call GET /api/loads.
  if (!can(me, "load:read:own")) {
    return <CarrierDashboard firstName={me.user.firstName} subtitle={subtitle} />;
  }
  return <ShipperDashboard firstName={me.user.firstName} subtitle={subtitle} />;
}

// ── shipper (unchanged behavior) ─────────────────────────────────────────

async function ShipperDashboard({
  firstName,
  subtitle,
}: {
  firstName: string;
  subtitle?: string;
}) {
  const [recent, loadTotal, draftTotal, postedTotal, locTotal, eqTotal] = await Promise.all([
    apiServer<Paginated<LoadListItem>>("/api/loads", { query: { pageSize: 6 } }),
    count("/api/loads"),
    count("/api/loads?status=DRAFT"),
    count("/api/loads?status=POSTED"),
    apiServer<Paginated<LocationView>>("/api/locations", { query: { pageSize: 1 } }).then(
      (r) => r.total,
    ),
    apiServer<Paginated<EquipmentView>>("/api/equipment", { query: { pageSize: 1 } }).then(
      (r) => r.total,
    ),
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
      <PageHeader title={`Welcome, ${firstName}`} subtitle={subtitle} />

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

// ── carrier ─────────────────────────────────────────────────────────────

const ELIGIBILITY_TONE: Record<string, "gray" | "green" | "amber" | "red" | "indigo"> = {
  PENDING: "amber",
  ELIGIBLE: "green",
  INELIGIBLE: "red",
  SUSPENDED: "red",
};

async function CarrierDashboard({
  firstName,
  subtitle,
}: {
  firstName: string;
  subtitle?: string;
}) {
  const [recentOffers, offerTotal, activeTotal, wonTotal, boardTotal, locTotal, eqTotal, profileRes] =
    await Promise.all([
      apiServer<Paginated<OfferThreadSummary>>("/api/offers", { query: { pageSize: 6 } }),
      count("/api/offers"),
      count("/api/offers?status=ACTIVE"),
      count("/api/offers?status=ACCEPTED"),
      // The board 403s for a carrier whose profile is not yet ELIGIBLE.
      safe(count("/api/marketplace/loads"), null as number | null),
      apiServer<Paginated<LocationView>>("/api/locations", { query: { pageSize: 1 } }).then(
        (r) => r.total,
      ),
      apiServer<Paginated<EquipmentView>>("/api/equipment", { query: { pageSize: 1 } }).then(
        (r) => r.total,
      ),
      apiServer<{ profile: CarrierProfileView | null }>("/api/carrier/profile"),
    ]);

  const profile = profileRes.profile;

  const stats: { label: string; value: number | string; href: string }[] = [
    { label: "Available", value: boardTotal ?? "—", href: "/marketplace" },
    { label: "Active offers", value: activeTotal, href: "/marketplace/offers" },
    { label: "Won", value: wonTotal, href: "/marketplace/offers" },
    { label: "Locations", value: locTotal, href: "/locations" },
    { label: "Equipment", value: eqTotal, href: "/equipment" },
  ];

  const notEligible = !profile || profile.marketplaceEligibility !== "ELIGIBLE";

  return (
    <div>
      <PageHeader title={`Welcome, ${firstName}`} subtitle={subtitle} />

      {notEligible && (
        <Card className="mb-6 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-ink">
                Marketplace status:{" "}
                <Badge tone={ELIGIBILITY_TONE[profile?.marketplaceEligibility ?? "PENDING"] ?? "gray"}>
                  {titleCase(profile?.marketplaceEligibility ?? "No profile")}
                </Badge>
              </p>
              <p className="mt-1 text-xs text-muted">
                {profile
                  ? "Complete verification on your carrier profile to browse and bid on freight."
                  : "Create your carrier profile to start bidding on freight."}
              </p>
            </div>
            <Link
              href="/settings/carrier-profile"
              className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Carrier profile
            </Link>
          </div>
        </Card>
      )}

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
          <h2 className="text-sm font-semibold text-ink">Recent negotiations</h2>
          <Link
            href="/marketplace/offers"
            className="text-sm font-medium text-brand-600 hover:underline"
          >
            View all
          </Link>
        </div>
        {offerTotal === 0 ? (
          <EmptyState
            title="No offers yet"
            description="Find freight on the marketplace and submit an offer."
            action={
              <Link
                href="/marketplace"
                className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                Browse the marketplace
              </Link>
            }
          />
        ) : (
          <Card className="divide-y divide-line">
            {recentOffers.data.map((t) => (
              <Link
                key={t.threadId}
                href={`/marketplace/${t.loadId}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-canvas"
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink">
                    {money(t.currentAmount, t.currentCurrency)}
                  </p>
                  <p className="truncate text-sm text-muted">
                    {t.roundCount} round{t.roundCount === 1 ? "" : "s"} · updated{" "}
                    {fmtDateTime(t.updatedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-sm">
                  {t.awaitingMyResponse && t.status === "ACTIVE" && (
                    <Badge tone="indigo">Your move</Badge>
                  )}
                  <Badge tone={THREAD_TONE[t.status] ?? "gray"}>{titleCase(t.status)}</Badge>
                </div>
              </Link>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}
