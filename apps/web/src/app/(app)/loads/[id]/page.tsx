import Link from "next/link";
import { notFound } from "next/navigation";
import type {
  OfferThreadSummary,
  OfferThreadView,
  PricingSnapshotView,
  LoadView,
} from "@loadtopia/shared";
import { ApiError, apiServer } from "@/lib/api-server";
import { Card, PageHeader } from "@/components/ui";
import { LoadStatusBadge } from "@/components/load-status-badge";
import { LoadActions } from "@/components/load-actions";
import { OfferThread } from "@/components/offer-thread";
import { AssignCarrierButton } from "@/components/assign-carrier-button";
import {
  fmtDateTime,
  fmtDriveTime,
  fmtMiles,
  fmtWeight,
  fmtWindow,
  titleCase,
} from "@/lib/format";

function money(v: string | null, currency = "USD") {
  return v == null ? "—" : new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(v));
}

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

const EVENT_LABEL: Record<string, string> = {
  CREATED: "Load created",
  UPDATED: "Load edited",
  STATUS_CHANGED: "Status changed",
  CANCELLED: "Load cancelled",
};

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{value}</dd>
    </div>
  );
}

function Addr({ loc }: { loc: LoadView["origin"] }) {
  return (
    <span>
      {loc.name && <span className="font-medium">{loc.name}: </span>}
      {loc.addressLine1}, {loc.city}, {loc.state} {loc.postalCode}
    </span>
  );
}

export default async function LoadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let load: LoadView;
  try {
    load = await apiServer<LoadView>(`/api/loads/${id}`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  }

  // Marketplace negotiations on this load (shipper-scoped). Best-effort so a
  // pre-marketplace load still renders.
  const { data: threadSummaries } = await safe(
    apiServer<{ data: OfferThreadSummary[] }>(`/api/loads/${id}/offers`),
    { data: [] as OfferThreadSummary[] },
  );
  const threads = await Promise.all(
    threadSummaries.map((t) =>
      safe(apiServer<OfferThreadView>(`/api/offers/threads/${t.threadId}`), null),
    ),
  ).then((list) => list.filter((t): t is OfferThreadView => t !== null));

  const { data: pricing } = await safe(
    apiServer<{ data: PricingSnapshotView[] }>(`/api/loads/${id}/pricing`),
    { data: [] as PricingSnapshotView[] },
  );

  const award = load.marketplace.award;

  return (
    <div>
      <PageHeader
        title={load.referenceNumber}
        subtitle={`Created ${fmtDateTime(load.createdAt)} · updated ${fmtDateTime(load.updatedAt)}`}
        action={<LoadStatusBadge status={load.status} />}
      />
      <Link href="/loads" className="mb-4 inline-block text-sm text-brand-600 hover:underline">
        ← All loads
      </Link>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">Load details</h2>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Detail label="Origin" value={<Addr loc={load.origin} />} />
              <Detail label="Destination" value={<Addr loc={load.destination} />} />
              <Detail label="Equipment" value={titleCase(load.equipmentType)} />
              <Detail label="Mode" value={load.mode} />
              <Detail label="Commodity" value={load.commodity ?? "—"} />
              <Detail label="Weight" value={fmtWeight(load.weightLbs)} />
              <Detail
                label="Pickup window"
                value={fmtWindow(load.pickupWindowStart, load.pickupWindowEnd)}
              />
              <Detail
                label="Delivery window"
                value={fmtWindow(load.deliveryWindowStart, load.deliveryWindowEnd)}
              />
              <Detail label="Distance" value={fmtMiles(load.routing.miles)} />
              <Detail
                label="Est. drive time"
                value={fmtDriveTime(load.routing.driveTimeMinutes)}
              />
            </dl>
            {load.routing.provider && (
              <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
                Routing via <code>{load.routing.provider}</code> provider
                {load.routing.isMock && " — MOCK development data, not real-world routing"} ·{" "}
                {fmtDateTime(load.routing.routedAt)}
              </p>
            )}
          </Card>

          {(threads.length > 0 || load.marketplace.onMarket || award) && (
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink">
                  Offers{" "}
                  <span className="text-muted">
                    ({load.marketplace.activeOfferCount} active)
                  </span>
                </h2>
              </div>

              {award && (
                <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
                  <p className="font-medium text-emerald-900">
                    Awarded to {award.carrierName} · {money(award.amount, award.currency)}
                  </p>
                  <p className="text-xs text-emerald-800">
                    Awarded {fmtDateTime(award.awardedAt)}
                    {award.assignedAt
                      ? ` · carrier assigned ${fmtDateTime(award.assignedAt)}`
                      : ""}
                  </p>
                  {load.status === "AWARDED" && (
                    <div className="mt-2">
                      <AssignCarrierButton loadId={load.id} />
                    </div>
                  )}
                </div>
              )}

              {threads.length === 0 ? (
                <p className="text-sm text-muted">No offers yet.</p>
              ) : (
                <div className="space-y-3">
                  {threads.map((t) => (
                    <OfferThread key={t.threadId} thread={t} />
                  ))}
                </div>
              )}
            </Card>
          )}

          {pricing.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-ink">Pricing snapshots</h2>
              <div className="space-y-2">
                {pricing.map((p) => (
                  <div key={p.id} className="rounded-lg border border-line p-3 text-sm">
                    <p>
                      <span className="font-medium">{money(p.midRate, p.currency)}</span>{" "}
                      <span className="text-muted">
                        ({money(p.lowRate, p.currency)}–{money(p.highRate, p.currency)}) ·{" "}
                        {p.confidence} confidence
                      </span>
                    </p>
                    <p className="text-xs text-muted">
                      {p.provider}
                      {p.isMock && " — MOCK development data, not real market pricing"} ·{" "}
                      {fmtDateTime(p.createdAt)}
                    </p>
                    {p.disclaimer && <p className="mt-1 text-xs text-muted">{p.disclaimer}</p>}
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">Timeline</h2>
            <ol className="space-y-3">
              {load.events.map((e) => (
                <li key={e.id} className="flex gap-3 text-sm">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-400" />
                  <div>
                    <p className="text-ink">
                      {EVENT_LABEL[e.type] ?? titleCase(e.type)}
                      {e.fromStatus && e.toStatus && (
                        <span className="text-muted">
                          {" "}
                          · {titleCase(e.fromStatus)} → {titleCase(e.toStatus)}
                        </span>
                      )}
                    </p>
                    {e.note && <p className="text-muted">“{e.note}”</p>}
                    <p className="text-xs text-muted">
                      {fmtDateTime(e.createdAt)}
                      {e.actorName && ` · ${e.actorName}`}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">Actions</h2>
            <LoadActions load={load} />
          </Card>
        </div>
      </div>
    </div>
  );
}
