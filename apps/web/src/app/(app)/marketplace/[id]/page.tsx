import Link from "next/link";
import { notFound } from "next/navigation";
import type {
  LoadView,
  MarketplaceLoadView,
  OfferThreadSummary,
  OfferThreadView,
} from "@loadtopia/shared";
import { ApiError, apiServer } from "@/lib/api-server";
import { Alert, Card, PageHeader } from "@/components/ui";
import { OfferThread } from "@/components/offer-thread";
import { CreateOfferForm } from "@/components/create-offer-form";
import { ShipmentProgress } from "@/components/operations/shipment-progress";
import { CheckInsPanel } from "@/components/operations/check-ins-panel";
import { RateConfirmationPanel } from "@/components/operations/rate-confirmation-panel";
import { requireMe } from "@/lib/session";
import { canRecordCheckIn, shouldShowOperations } from "@/lib/operations";
import { fetchCheckIns, fetchRateConfirmation } from "@/lib/operations-data";
import { fmtDateTime, fmtMiles, fmtWeight, fmtWindow, titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{value}</dd>
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

function money(v: string | null, currency = "USD") {
  return v == null
    ? "—"
    : new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(v));
}

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
  if (!market) {
    try {
      load = await apiServer<LoadView>(`/api/loads/${id}`);
    } catch (err) {
      if (isScopeError(err)) notFound();
      throw err;
    }
  }

  // The carrier's own negotiation on this load, if any.
  const { thread: summary } = await safe(
    apiServer<{ thread: OfferThreadSummary | null }>(`/api/marketplace/loads/${id}/offers`),
    { thread: null as OfferThreadSummary | null },
  );
  const thread: OfferThreadView | null = summary
    ? await safe(apiServer<OfferThreadView>(`/api/offers/threads/${summary.threadId}`), null)
    : null;

  // ── Operational load (assigned / in motion / delivered / completed) ──
  if (load && shouldShowOperations(load)) {
    const [checkIns, rateConfirmation] = await Promise.all([
      fetchCheckIns(id),
      fetchRateConfirmation(id),
    ]);
    const award = load.marketplace.award;

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

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card className="p-5">
              <h2 className="mb-4 text-sm font-semibold text-ink">Shipment progress</h2>
              <ShipmentProgress load={load} />
            </Card>

            <Card className="p-5">
              <h2 className="mb-4 text-sm font-semibold text-ink">Load details</h2>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Detail
                  label="Origin"
                  value={`${load.origin.city}, ${load.origin.state}`}
                />
                <Detail
                  label="Destination"
                  value={`${load.destination.city}, ${load.destination.state}`}
                />
                <Detail label="Equipment" value={titleCase(load.equipmentType)} />
                <Detail label="Mode" value={load.mode} />
                <Detail label="Commodity" value={load.commodity ?? "—"} />
                <Detail label="Weight" value={fmtWeight(load.weightLbs)} />
                <Detail
                  label="Pickup"
                  value={fmtWindow(load.pickupWindowStart, load.pickupWindowEnd)}
                />
                <Detail
                  label="Delivery"
                  value={fmtWindow(load.deliveryWindowStart, load.deliveryWindowEnd)}
                />
                <Detail label="Distance" value={fmtMiles(load.routing.miles)} />
              </dl>
            </Card>

            <Card className="p-5">
              <h2 className="mb-4 text-sm font-semibold text-ink">Check-ins</h2>
              <CheckInsPanel
                loadId={load.id}
                checkIns={checkIns}
                canRecord={canRecordCheckIn(me, load)}
              />
            </Card>

            {thread && (
              <Card className="p-5">
                <h2 className="mb-4 text-sm font-semibold text-ink">Your negotiation</h2>
                <OfferThread thread={thread} />
              </Card>
            )}
          </div>

          <div className="space-y-6">
            {award && (
              <Card className="p-5">
                <h2 className="mb-2 text-sm font-semibold text-ink">Booking</h2>
                <p className="text-sm text-ink">
                  Booked at{" "}
                  <span className="font-semibold">{money(award.amount, award.currency)}</span>
                </p>
                <p className="mt-1 text-xs text-muted">
                  Awarded {fmtDateTime(award.awardedAt)}
                  {award.assignedAt
                    ? ` · assigned ${fmtDateTime(award.assignedAt)}`
                    : " · awaiting shipper assignment"}
                </p>
              </Card>
            )}

            {rateConfirmation !== null && (
              <Card className="p-5">
                <h2 className="mb-3 text-sm font-semibold text-ink">Rate Confirmation</h2>
                <RateConfirmationPanel loadId={load.id} state={rateConfirmation} />
              </Card>
            )}
          </div>
        </div>
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
      />
      <Link href="/marketplace" className="mb-4 inline-block text-sm text-brand-600 hover:underline">
        ← Marketplace
      </Link>

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
                    {money(load.marketplace.award.amount, load.marketplace.award.currency)}
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
                <h2 className="mb-3 text-sm font-semibold text-ink">Make an offer</h2>
                {thread ? (
                  <p className="text-sm text-muted">
                    You have{" "}
                    {thread.status === "ACTIVE" ? "an active" : `a ${titleCase(thread.status)}`}{" "}
                    negotiation on this load. Manage it on the left.
                  </p>
                ) : canOffer ? (
                  <CreateOfferForm loadId={id} />
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
