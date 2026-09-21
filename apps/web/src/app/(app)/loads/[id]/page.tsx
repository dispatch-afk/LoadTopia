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
import { AudiencePanel } from "@/components/loads/audience-panel";
import { ShipmentDetail } from "@/components/operations/shipment-detail";
import { ShipmentTimeline } from "@/components/operations/shipment-timeline";
import { ShipperCompleteAction } from "@/components/operations/shipper-complete-action";
import { requireMe } from "@/lib/session";
import {
  canRecordCheckIn,
  canReviewPod,
  canUploadDocument,
  shouldShowOperations,
  viewerRoleForLoad,
} from "@/lib/operations";
import { fetchCheckIns, fetchDocuments, fetchRateConfirmation } from "@/lib/operations-data";
import { fmtDateTime, fmtDriveTime, fmtMiles, fmtMoney, fmtWeight, fmtWindow, titleCase } from "@/lib/format";

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

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
  const me = await requireMe();
  let load: LoadView;
  try {
    load = await apiServer<LoadView>(`/api/loads/${id}`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  }

  // Marketplace negotiations on this load (shipper-scoped). Best-effort so a
  // pre-marketplace load still renders. Private to the shipper — never shown
  // to the carrier, and deliberately kept OUTSIDE the shared Shipment Detail
  // composition below (see ShipmentDetail's doc comment).
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
  const showOps = shouldShowOperations(load);
  const viewerRole = viewerRoleForLoad(me, load);

  const [checkIns, documents, rateConfirmation] = showOps
    ? await Promise.all([fetchCheckIns(id), fetchDocuments(id), fetchRateConfirmation(id)])
    : [[], [], null];

  // Milestone 4 Phase 12: once covered/operational, this is customer-facing a
  // Shipment, not a Load — the back-link returns to the Shipments workspace
  // it's actually listed on, not the Loads workspace it left once covered.
  const header = (
    <>
      <PageHeader
        title={load.referenceNumber}
        subtitle={`Created ${fmtDateTime(load.createdAt)} · updated ${fmtDateTime(load.updatedAt)}`}
        action={<LoadStatusBadge status={load.status} />}
      />
      <Link
        href={showOps ? "/shipments" : "/loads"}
        className="mb-4 inline-block text-sm text-brand-600 hover:underline"
      >
        {showOps ? "← Shipments" : "← All loads"}
      </Link>
    </>
  );

  // ── Operational shipment (covered freight — CARRIER_ASSIGNED or later, or
  // a historical AWARDED-only legacy record): the shared, role-aware
  // Shipment Detail (Milestone 4 Phase 6). Commercial negotiation history
  // (Offers/threads/audience) is shipper-private and stays a separate
  // section below it, never inside the shared composition. ──
  if (showOps) {
    return (
      <div>
        {header}

        <ShipmentDetail
          load={load}
          checkIns={checkIns}
          documents={documents}
          rateConfirmation={rateConfirmation}
          viewerCompanyId={me.activeCompanyId}
          canRecordCheckIn={canRecordCheckIn(me, load)}
          canUploadDocument={canUploadDocument(me, load)}
          canReviewPod={canReviewPod(me, load)}
          actions={
            <div className="space-y-3">
              <LoadActions load={load} />
              {(viewerRole === "shipper" || viewerRole === "admin") && (
                <ShipperCompleteAction load={load} />
              )}
            </div>
          }
        />

        {(threads.length > 0 || pricing.length > 0 || load.status === "AWARDED" || load.audience) && (
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              {(threads.length > 0 || load.status === "AWARDED") && (
                <Card className="p-5">
                  <h2 className="mb-4 text-sm font-semibold text-ink">
                    Offers{" "}
                    <span className="text-muted">({load.marketplace.activeOfferCount} active)</span>
                  </h2>
                  {load.status === "AWARDED" && (
                    <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
                      <p className="mb-1.5 text-xs text-emerald-800">
                        This load predates automatic carrier assignment.
                      </p>
                      <AssignCarrierButton loadId={load.id} />
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
                          <span className="font-medium">{fmtMoney(p.midRate, p.currency)}</span>{" "}
                          <span className="text-muted">
                            ({fmtMoney(p.lowRate, p.currency)}–{fmtMoney(p.highRate, p.currency)}) ·{" "}
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
            </div>

            <div className="space-y-6">
              {load.audience && (viewerRole === "shipper" || viewerRole === "admin") && (
                <Card className="p-5">
                  <AudiencePanel load={load} canManage={viewerRole === "shipper" || viewerRole === "admin"} />
                </Card>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Pre-operational (DRAFT/POSTED/OFFER_RECEIVED, or CANCELLED before any
  // award) — unchanged commercial-only load detail. ──
  return (
    <div>
      {header}

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
                      <span className="font-medium">{fmtMoney(p.midRate, p.currency)}</span>{" "}
                      <span className="text-muted">
                        ({fmtMoney(p.lowRate, p.currency)}–{fmtMoney(p.highRate, p.currency)}) ·{" "}
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
            <ShipmentTimeline events={load.events} />
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">Actions</h2>
            <div className="space-y-3">
              <LoadActions load={load} />
            </div>
          </Card>

          {load.audience && (viewerRole === "shipper" || viewerRole === "admin") && (
            <Card className="p-5">
              <AudiencePanel load={load} canManage={viewerRole === "shipper" || viewerRole === "admin"} />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
