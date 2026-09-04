import Link from "next/link";
import { notFound } from "next/navigation";
import type {
  EquipmentType,
  LoadStatus,
  LoadView,
  MarketplaceLoadView,
  OfferThreadSummary,
  OfferThreadView,
  TransportMode,
} from "@loadtopia/shared";
import { ApiError, apiServer } from "@/lib/api-server";
import { Alert, Card, PageHeader } from "@/components/ui";
import { OfferThread } from "@/components/offer-thread";
import { CreateOfferForm } from "@/components/create-offer-form";
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

/**
 * A single load in the carrier's marketplace flow.
 *
 *  - While the load is on-market (`POSTED` / `OFFER_RECEIVED`) it comes from the
 *    marketplace endpoint, which enforces board eligibility + visibility.
 *  - Once the load leaves the market (`AWARDED` / `CARRIER_ASSIGNED`) the
 *    marketplace endpoint correctly 404s. We then fall back to `GET /api/loads/:id`,
 *    which the server authorizes ONLY for the load's shipper or its awarded
 *    carrier (`canReadLoad`). An unrelated carrier gets 404 from both → notFound().
 *
 * The marketplace visibility rules are unchanged — this page never widens them.
 */
interface LoadDisplay {
  id: string;
  referenceNumber: string;
  status: LoadStatus;
  equipmentType: EquipmentType;
  mode: TransportMode;
  commodity: string | null;
  weightLbs: number | null;
  origin: { city: string; state: string };
  destination: { city: string; state: string };
  pickupWindowStart: string | null;
  pickupWindowEnd: string | null;
  deliveryWindowStart: string | null;
  deliveryWindowEnd: string | null;
  miles: number | null;
  /** Present only on-market (from the marketplace endpoint). */
  market: { shipperName: string; eligible: boolean; reasons: string[] } | null;
  /** Present only off-market (from GET /api/loads/:id → the awarded carrier). */
  award: LoadView["marketplace"]["award"];
}

function fromMarketplace(m: MarketplaceLoadView): LoadDisplay {
  return {
    id: m.id,
    referenceNumber: m.referenceNumber,
    status: m.status,
    equipmentType: m.equipmentType,
    mode: m.mode,
    commodity: m.commodity,
    weightLbs: m.weightLbs,
    origin: { city: m.origin.city, state: m.origin.state },
    destination: { city: m.destination.city, state: m.destination.state },
    pickupWindowStart: m.pickupWindowStart,
    pickupWindowEnd: m.pickupWindowEnd,
    deliveryWindowStart: m.deliveryWindowStart,
    deliveryWindowEnd: m.deliveryWindowEnd,
    miles: m.miles,
    market: {
      shipperName: m.shipperName,
      eligible: m.eligibility.eligible,
      reasons: m.eligibility.reasons,
    },
    award: null,
  };
}

function fromLoadView(l: LoadView): LoadDisplay {
  return {
    id: l.id,
    referenceNumber: l.referenceNumber,
    status: l.status,
    equipmentType: l.equipmentType,
    mode: l.mode,
    commodity: l.commodity,
    weightLbs: l.weightLbs,
    origin: { city: l.origin.city, state: l.origin.state },
    destination: { city: l.destination.city, state: l.destination.state },
    pickupWindowStart: l.pickupWindowStart,
    pickupWindowEnd: l.pickupWindowEnd,
    deliveryWindowStart: l.deliveryWindowStart,
    deliveryWindowEnd: l.deliveryWindowEnd,
    miles: l.routing.miles,
    market: null,
    award: l.marketplace.award,
  };
}

const isScopeError = (err: unknown) =>
  err instanceof ApiError && (err.status === 404 || err.status === 403 || err.status === 400);

export default async function MarketplaceLoadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let load: LoadDisplay;
  try {
    load = fromMarketplace(await apiServer<MarketplaceLoadView>(`/api/marketplace/loads/${id}`));
  } catch (err) {
    if (!isScopeError(err)) throw err;
    // Off-market load: the marketplace endpoint stays 404 for everyone. Fall back
    // to the authenticated load endpoint, which the server authorizes only for
    // the shipper or the awarded carrier of THIS load.
    try {
      load = fromLoadView(await apiServer<LoadView>(`/api/loads/${id}`));
    } catch (err2) {
      if (isScopeError(err2)) notFound();
      throw err2;
    }
  }

  // The carrier's own negotiation on this load, if any. The summary is used only
  // to resolve the thread id; the full view (with redaction applied server-side
  // for a CARRIER viewer) comes from GET /api/offers/threads/:threadId.
  const { thread: summary } = await apiServer<{ thread: OfferThreadSummary | null }>(
    `/api/marketplace/loads/${id}/offers`,
  );
  const thread: OfferThreadView | null = summary
    ? await apiServer<OfferThreadView>(`/api/offers/threads/${summary.threadId}`)
    : null;

  const canOffer = load.market !== null && load.market.eligible && thread === null;

  return (
    <div>
      <PageHeader
        title={load.referenceNumber}
        subtitle={
          load.market
            ? `Posted by ${load.market.shipperName}`
            : `This load is ${titleCase(load.status)} — no longer on the marketplace`
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
              <Detail label="Origin" value={`${load.origin.city}, ${load.origin.state}`} />
              <Detail
                label="Destination"
                value={`${load.destination.city}, ${load.destination.state}`}
              />
              <Detail label="Equipment" value={titleCase(load.equipmentType)} />
              <Detail label="Mode" value={load.mode} />
              <Detail label="Commodity" value={load.commodity ?? "—"} />
              <Detail label="Weight" value={fmtWeight(load.weightLbs)} />
              <Detail label="Pickup" value={fmtWindow(load.pickupWindowStart, load.pickupWindowEnd)} />
              <Detail
                label="Delivery"
                value={fmtWindow(load.deliveryWindowStart, load.deliveryWindowEnd)}
              />
              <Detail label="Distance" value={fmtMiles(load.miles)} />
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
            {load.award ? (
              <>
                <h2 className="mb-3 text-sm font-semibold text-ink">You won this load</h2>
                <p className="text-sm text-ink">
                  Booked at{" "}
                  <span className="font-semibold">
                    {money(load.award.amount, load.award.currency)}
                  </span>
                </p>
                <p className="mt-1 text-xs text-muted">
                  Awarded {fmtDateTime(load.award.awardedAt)}
                  {load.award.assignedAt
                    ? ` · carrier assigned ${fmtDateTime(load.award.assignedAt)}`
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
                  <CreateOfferForm loadId={load.id} />
                ) : load.market ? (
                  <Alert tone="info">
                    You cannot offer on this load:
                    <ul className="mt-1 list-disc pl-5">
                      {load.market.reasons.map((r) => (
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
