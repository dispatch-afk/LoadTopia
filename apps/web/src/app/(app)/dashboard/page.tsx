import Link from "next/link";
import type { DashboardSummaryView } from "@loadtopia/shared";
import { apiServer } from "@/lib/api-server";
import { requireMe, activeMembership } from "@/lib/session";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { AttentionCenter, type AttentionCenterEntry } from "@/components/dashboard/attention-center";
import { fmtDateTime, fmtMoney, titleCase } from "@/lib/format";
import {
  CARRIER_ATTENTION_HREF,
  CARRIER_ATTENTION_LABEL,
  SHIPPER_ATTENTION_HREF,
  SHIPPER_ATTENTION_LABEL,
} from "@/lib/dashboard-attention";
import { OFFER_THREAD_STATUS_TONE } from "@/lib/status-tone";

export default async function DashboardPage() {
  const me = await requireMe();
  const membership = activeMembership(me);
  const subtitle = membership ? `${membership.companyName} · ${membership.role}` : undefined;

  const summary = await apiServer<DashboardSummaryView>("/api/dashboard/summary");

  return (
    <div>
      <PageHeader title={`Welcome, ${me.user.firstName}`} subtitle={subtitle} />
      {summary.role === "SHIPPER" ? (
        <ShipperDashboard summary={summary} />
      ) : (
        <CarrierDashboard summary={summary} />
      )}
    </div>
  );
}

// ── shipper ─────────────────────────────────────────────────────────────

function ShipperDashboard({ summary }: { summary: Extract<DashboardSummaryView, { role: "SHIPPER" }> }) {
  const attentionItems: AttentionCenterEntry[] = summary.attention.map((item) => ({
    key: item.kind,
    label: SHIPPER_ATTENTION_LABEL[item.kind],
    count: item.count,
    href: SHIPPER_ATTENTION_HREF[item.kind],
  }));

  const overview = [
    { label: "Active Shipments", value: summary.overview.activeShipmentCount, href: "/shipments" },
    { label: "Draft Loads", value: summary.overview.draftLoadCount, href: "/loads?status=DRAFT" },
    { label: "Total Loads", value: summary.overview.totalLoadCount, href: "/loads" },
  ];

  return (
    <>
      <div className="mt-6">
        <AttentionCenter items={attentionItems} />
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3">
        {overview.map((s) => (
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
          <h2 className="text-sm font-semibold text-ink">Recent shipments</h2>
          <Link href="/shipments" className="text-sm font-medium text-brand-600 hover:underline">
            View all
          </Link>
        </div>
        {summary.overview.totalLoadCount === 0 ? (
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
        ) : summary.recentShipments.length === 0 ? (
          <EmptyState
            title="No active shipments yet"
            description="Once a carrier is assigned to a load, it will appear here."
            action={
              <Link href="/loads" className="text-sm font-medium text-brand-600 hover:underline">
                View your loads
              </Link>
            }
          />
        ) : (
          <Card className="divide-y divide-line">
            {summary.recentShipments.map((s) => (
              <Link
                key={s.id}
                href={`/loads/${s.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-canvas"
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink">{s.referenceNumber}</p>
                  <p className="truncate text-sm text-muted">
                    {s.origin.city}, {s.origin.state} → {s.destination.city}, {s.destination.state}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-4 text-sm text-muted">
                  <span className="hidden sm:inline">{fmtDateTime(s.updatedAt)}</span>
                  <Badge tone="indigo">{s.nextAction}</Badge>
                </div>
              </Link>
            ))}
          </Card>
        )}
      </div>
    </>
  );
}

// ── carrier ─────────────────────────────────────────────────────────────

const ELIGIBILITY_TONE: Record<string, "gray" | "green" | "amber" | "red" | "indigo"> = {
  PENDING: "amber",
  ELIGIBLE: "green",
  INELIGIBLE: "red",
  SUSPENDED: "red",
};

function CarrierDashboard({ summary }: { summary: Extract<DashboardSummaryView, { role: "CARRIER" }> }) {
  const attentionItems: AttentionCenterEntry[] = summary.attention.map((item) => ({
    key: item.kind,
    label: CARRIER_ATTENTION_LABEL[item.kind],
    count: item.count,
    href: CARRIER_ATTENTION_HREF[item.kind],
  }));

  const overview = [
    {
      label: "Available Freight",
      value: summary.overview.availableFreightCount ?? "—",
      href: "/marketplace",
    },
    { label: "Active Offers", value: summary.overview.activeOfferCount, href: "/marketplace/offers" },
    { label: "Won / Assigned", value: summary.overview.wonShipmentCount, href: "/my-shipments" },
  ];

  return (
    <>
      {!summary.marketplaceEligible && (
        <Card className="mb-6 mt-6 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-ink">
                Marketplace status: <Badge tone={ELIGIBILITY_TONE.PENDING}>Not eligible yet</Badge>
              </p>
              <p className="mt-1 text-xs text-muted">
                Complete verification on your carrier profile to browse and bid on freight.
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

      <div className={summary.marketplaceEligible ? "mt-6" : ""}>
        <AttentionCenter items={attentionItems} />
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3">
        {overview.map((s) => (
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
          <h2 className="text-sm font-semibold text-ink">My shipments</h2>
          <Link href="/my-shipments" className="text-sm font-medium text-brand-600 hover:underline">
            View all
          </Link>
        </div>
        {summary.recentShipments.length === 0 ? (
          <EmptyState
            title="No active shipments yet"
            description="Shipments you're assigned to will appear here."
            action={
              summary.marketplaceEligible ? (
                <Link href="/marketplace" className="text-sm font-medium text-brand-600 hover:underline">
                  Browse the marketplace
                </Link>
              ) : undefined
            }
          />
        ) : (
          <Card className="divide-y divide-line">
            {summary.recentShipments.map((s) => (
              <Link
                key={s.id}
                href={`/marketplace/${s.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-canvas"
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink">{s.referenceNumber}</p>
                  <p className="truncate text-sm text-muted">
                    {s.origin.city}, {s.origin.state} → {s.destination.city}, {s.destination.state}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-4 text-sm text-muted">
                  <span className="hidden sm:inline">{fmtDateTime(s.updatedAt)}</span>
                  <Badge tone="indigo">{s.nextAction}</Badge>
                </div>
              </Link>
            ))}
          </Card>
        )}
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
        {summary.recentOffers.length === 0 ? (
          <EmptyState
            title="No offers yet"
            description="Find freight on the marketplace and submit an offer."
            action={
              summary.marketplaceEligible ? (
                <Link
                  href="/marketplace"
                  className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700"
                >
                  Browse the marketplace
                </Link>
              ) : undefined
            }
          />
        ) : (
          <Card className="divide-y divide-line">
            {summary.recentOffers.map((t) => (
              <Link
                key={t.threadId}
                href={`/marketplace/${t.loadId}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-canvas"
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink">
                    {fmtMoney(t.currentAmount, t.currentCurrency)}
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
                  <Badge tone={OFFER_THREAD_STATUS_TONE[t.status]}>{titleCase(t.status)}</Badge>
                </div>
              </Link>
            ))}
          </Card>
        )}
      </div>
    </>
  );
}
