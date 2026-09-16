import Link from "next/link";
import { notFound } from "next/navigation";
import type {
  LoadView,
  MarketplaceLoadView,
  OfferThreadSummary,
  OfferThreadView,
} from "@loadtopia/shared";
import { ApiError, apiServer } from "@/lib/api-server";
import { Alert, Badge, Card, PageHeader } from "@/components/ui";
import { OfferThread } from "@/components/offer-thread";
import { CreateOfferForm } from "@/components/create-offer-form";
import { BookAtPostedRateButton } from "@/components/book-at-posted-rate-button";
import { ShipmentDetail } from "@/components/operations/shipment-detail";
import { CarrierShipmentActions } from "@/components/operations/carrier-shipment-actions";
import { requireMe } from "@/lib/session";
import {
  canRecordCheckIn,
  canReviewPod,
  canUploadDocument,
  shouldShowOperations,
  viewerRoleForLoad,
} from "@/lib/operations";
import { fetchCheckIns, fetchDocuments, fetchRateConfirmation } from "@/lib/operations-data";
import { fmtDateTime, fmtMiles, fmtMoney, fmtWeight, fmtWindow, titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{value}</dd>
    </div>
  );
}

/**
 * Milestone 4 Phase 9 — a losing carrier's truthful historical view. Built
 * ENTIRELY from this carrier's own OfferThreadView (never the winner, never
 * a competing rate, never Rate Confirmation/shipment/document data — none of
 * that is fetched here, let alone rendered). `thread.load` carries only the
 * lane/reference facts already legitimately part of this carrier's own
 * negotiation record.
 */
function LoadCoveredView({ thread }: { thread: OfferThreadView }) {
  const covered = thread.closedReason === "load_awarded_to_other";
  return (
    <div>
      <PageHeader
        title={thread.load.referenceNumber}
        subtitle={covered ? "Load Covered" : "No longer available"}
      />
      <Link href="/marketplace" className="mb-4 inline-block text-sm text-brand-600 hover:underline">
        ← Marketplace
      </Link>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">Load details</h2>
            <p className="mb-4 text-sm text-muted">
              {covered
                ? "This load has been covered and is no longer available."
                : "This load is no longer available."}
            </p>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Detail label="Origin" value={`${thread.load.origin.city}, ${thread.load.origin.state}`} />
              <Detail
                label="Destination"
                value={`${thread.load.destination.city}, ${thread.load.destination.state}`}
              />
              <Detail label="Equipment" value={titleCase(thread.load.equipmentType)} />
            </dl>
          </Card>

          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">Your negotiation</h2>
            <OfferThread thread={thread} />
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">Find your next load</h2>
            <p className="mb-3 text-sm text-muted">
              This one isn&apos;t available anymore, but new freight is posted continually.
            </p>
            <Link
              href="/marketplace"
              className="inline-block rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Browse the marketplace
            </Link>
          </Card>
        </div>
      </div>
    </div>
  );
}

const REASON_LABEL: Record<string, string> = {
  EQUIPMENT_INCOMPATIBLE: "Your profile equipment does not cover this load",
  SERVICE_AREA_MISMATCH: "This origin is outside your service area",
  PROFILE_NOT_ELIGIBLE: "Your marketplace profile is not eligible",
  CARRIER_NOT_OPERATING: "Your carrier profile is not marked as operating",
  LOAD_ALREADY_AWARDED: "This load has already been awarded",
  LOAD_NOT_ON_MARKET: "This load is no longer on the marketplace",
};

const isScopeError = (err: unknown) =>
  err instanceof ApiError && (err.status === 404 || err.status === 403 || err.status === 400);

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export default async function MarketplaceLoadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireMe();

  // On-market: the marketplace endpoint enforces board eligibility + visibility.
  let market: MarketplaceLoadView | null = null;
  try {
    market = await apiServer<MarketplaceLoadView>(`/api/marketplace/loads/${id}`);
  } catch (err) {
    if (!isScopeError(err)) throw err;
  }

  // Off-market: fall back to the authenticated load endpoint, authorized by the
  // server only for this load's shipper or awarded carrier.
  let load: LoadView | null = null;
  let loadInaccessible = false;
  if (!market) {
    try {
      load = await apiServer<LoadView>(`/api/loads/${id}`);
    } catch (err) {
      if (isScopeError(err)) {
        loadInaccessible = true;
      } else {
        throw err;
      }
    }
  }

  // The carrier's own negotiation on this load, if any — fetched regardless
  // of market/load access. A carrier's own offer thread is authorized by
  // thread PARTICIPATION (see OffersService#getThread's viewerParty check),
  // never by the load's current award/visibility state, so this still
  // resolves even once the load has left the marketplace and gone to a
  // different carrier (Milestone 4 Phase 9) — the mechanism a losing
  // carrier's truthful "Load Covered" view below is built from.
  const { thread: summary } = await safe(
    apiServer<{ thread: OfferThreadSummary | null }>(`/api/marketplace/loads/${id}/offers`),
    { thread: null as OfferThreadSummary | null },
  );
  const thread: OfferThreadView | null = summary
    ? await safe(apiServer<OfferThreadView>(`/api/offers/threads/${summary.threadId}`), null)
    : null;

  // Neither market/load access nor this carrier's own thread history
  // resolved anything — genuinely unrelated to this load.
  if (loadInaccessible && !market && !load && !thread) {
    notFound();
  }

  // Off-market, not the shipper/winner, but this carrier DID participate —
  // a truthful historical commercial view, never the winner or its terms.
  if (loadInaccessible && !market && !load && thread) {
    return <LoadCoveredView thread={thread} />;
  }

  // ── Operational shipment (assigned / in motion / delivered / completed) —
  // the SAME shared, role-aware Shipment Detail the shipper's /loads/:id
  // uses for covered freight (Milestone 4 Phase 6). Private negotiation
  // ("Your negotiation" — this carrier's OWN thread only, never a
  // competitor's) stays outside it, exactly as the shipper's private Offers
  // section does on the other route. ──
  if (load && shouldShowOperations(load)) {
    const [checkIns, documents, rateConfirmation] = await Promise.all([
      fetchCheckIns(id),
      fetchDocuments(id),
      fetchRateConfirmation(id),
    ]);
    const viewerRole = viewerRoleForLoad(me, load);
    const showCarrierActions = viewerRole === "carrier" || viewerRole === "admin";

    return (
      <div>
        <PageHeader
          title={load.referenceNumber}
          subtitle={`This load is ${titleCase(load.status)}`}
        />
        <Link
          href="/marketplace"
          className="mb-4 inline-block text-sm text-brand-600 hover:underline"
        >
          ← Marketplace
        </Link>

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
            showCarrierActions ? (
              <CarrierShipmentActions load={load} />
            ) : (
              <p className="text-sm text-muted">No actions available for this account.</p>
            )
          }
        />

        {thread && (
          <div className="mt-6">
            <Card className="p-5">
              <h2 className="mb-4 text-sm font-semibold text-ink">Your negotiation</h2>
              <OfferThread thread={thread} />
            </Card>
          </div>
        )}
      </div>
    );
  }

  // ── Marketplace load (on-market, or off-market with no operations yet) ──
  const canOffer = market !== null && market.eligibility.eligible && thread === null;
  const ref = market?.referenceNumber ?? load?.referenceNumber ?? "Load";
  const originText = market
    ? `${market.origin.city}, ${market.origin.state}`
    : load
      ? `${load.origin.city}, ${load.origin.state}`
      : "—";
  const destText = market
    ? `${market.destination.city}, ${market.destination.state}`
    : load
      ? `${load.destination.city}, ${load.destination.state}`
      : "—";

  return (
    <div>
      <PageHeader
        title={ref}
        subtitle={
          market
            ? `Posted by ${market.shipperName}`
            : `This load is ${titleCase(load?.status ?? "")} — no longer on the marketplace`
        }
        action={market?.shipperIsConnected ? <Badge tone="indigo">Connected shipper</Badge> : undefined}
      />
      <Link href="/marketplace" className="mb-2 inline-block text-sm text-brand-600 hover:underline">
        ← Marketplace
      </Link>
      {market && (
        <Link
          href={`/network/companies/${market.shipperCompanyId}`}
          className="mb-4 block text-sm text-brand-600 hover:underline"
        >
          View shipper profile &amp; connect →
        </Link>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">Load details</h2>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Detail label="Origin" value={originText} />
              <Detail label="Destination" value={destText} />
              <Detail
                label="Equipment"
                value={titleCase(market?.equipmentType ?? load?.equipmentType ?? "—")}
              />
              <Detail label="Mode" value={market?.mode ?? load?.mode ?? "—"} />
              <Detail label="Commodity" value={market?.commodity ?? load?.commodity ?? "—"} />
              <Detail
                label="Weight"
                value={fmtWeight(market?.weightLbs ?? load?.weightLbs ?? null)}
              />
              <Detail
                label="Pickup"
                value={fmtWindow(
                  market?.pickupWindowStart ?? load?.pickupWindowStart ?? null,
                  market?.pickupWindowEnd ?? load?.pickupWindowEnd ?? null,
                )}
              />
              <Detail
                label="Delivery"
                value={fmtWindow(
                  market?.deliveryWindowStart ?? load?.deliveryWindowStart ?? null,
                  market?.deliveryWindowEnd ?? load?.deliveryWindowEnd ?? null,
                )}
              />
              <Detail
                label="Distance"
                value={
                  <>
                    {fmtMiles(market?.miles ?? load?.routing.miles ?? null)}
                    {(market?.routing.isMock ?? load?.routing.isMock) && (
                      <span className="mt-0.5 block text-xs text-muted">
                        MOCK development data, not real-world routing
                      </span>
                    )}
                  </>
                }
              />
              {market?.commercialMode === "PUBLISH_RATE" && market.postedRate && (
                <Detail
                  label="Posted rate"
                  value={
                    <>
                      <span className="font-semibold">{fmtMoney(market.postedRate)}</span>
                      {market.ratePerMile && (
                        <span className="ml-1.5 text-muted">${market.ratePerMile}/mi</span>
                      )}
                    </>
                  }
                />
              )}
            </dl>
          </Card>

          {thread && (
            <Card className="p-5">
              <h2 className="mb-4 text-sm font-semibold text-ink">Your negotiation</h2>
              <OfferThread thread={thread} />
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            {load?.marketplace.award ? (
              <>
                <h2 className="mb-3 text-sm font-semibold text-ink">You won this load</h2>
                <p className="text-sm text-ink">
                  Booked at{" "}
                  <span className="font-semibold">
                    {fmtMoney(load.marketplace.award.amount, load.marketplace.award.currency)}
                  </span>
                </p>
                <p className="mt-1 text-xs text-muted">
                  Awarded {fmtDateTime(load.marketplace.award.awardedAt)}
                  {load.marketplace.award.assignedAt
                    ? ` · carrier assigned ${fmtDateTime(load.marketplace.award.assignedAt)}`
                    : " · awaiting shipper assignment"}
                </p>
              </>
            ) : (
              <>
                <h2 className="mb-3 text-sm font-semibold text-ink">
                  {market?.commercialMode === "PUBLISH_RATE" ? "Book or offer" : "Make an offer"}
                </h2>
                {thread ? (
                  <p className="text-sm text-muted">
                    You have{" "}
                    {thread.status === "ACTIVE" ? "an active" : `a ${titleCase(thread.status)}`}{" "}
                    negotiation on this load. Manage it on the left.
                  </p>
                ) : canOffer ? (
                  <div className="space-y-3">
                    {market?.commercialMode === "PUBLISH_RATE" && market.postedRate && (
                      <BookAtPostedRateButton loadId={id} postedRate={market.postedRate} />
                    )}
                    <div className={market?.commercialMode === "PUBLISH_RATE" ? "border-t border-line pt-3" : ""}>
                      {market?.commercialMode === "PUBLISH_RATE" && (
                        <p className="mb-2 text-xs text-muted">Prefer to negotiate instead?</p>
                      )}
                      <CreateOfferForm loadId={id} />
                    </div>
                  </div>
                ) : market ? (
                  <Alert tone="info">
                    You cannot offer on this load:
                    <ul className="mt-1 list-disc pl-5">
                      {market.eligibility.reasons.map((r) => (
                        <li key={r}>{REASON_LABEL[r] ?? titleCase(r)}</li>
                      ))}
                    </ul>
                  </Alert>
                ) : (
                  <p className="text-sm text-muted">This load is no longer on the marketplace.</p>
                )}
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
