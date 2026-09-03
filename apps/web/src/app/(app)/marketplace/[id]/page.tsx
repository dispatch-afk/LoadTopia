import Link from "next/link";
import { notFound } from "next/navigation";
import type { MarketplaceLoadView, OfferThreadView } from "@loadtopia/shared";
import { ApiError, apiServer } from "@/lib/api-server";
import { Alert, Card, PageHeader } from "@/components/ui";
import { OfferThread } from "@/components/offer-thread";
import { CreateOfferForm } from "@/components/create-offer-form";
import { fmtMiles, fmtWeight, fmtWindow, titleCase } from "@/lib/format";

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
  LOAD_ALREADY_AWARDED: "This load has already been awarded",
  LOAD_NOT_ON_MARKET: "This load is no longer on the marketplace",
};

export default async function MarketplaceLoadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let load: MarketplaceLoadView;
  try {
    load = await apiServer<MarketplaceLoadView>(`/api/marketplace/loads/${id}`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) notFound();
    throw err;
  }

  const { thread } = await apiServer<{ thread: OfferThreadView | null }>(
    `/api/marketplace/loads/${id}/offers`,
  );

  return (
    <div>
      <PageHeader title={load.referenceNumber} subtitle={`Posted by ${load.shipperName}`} />
      <Link href="/marketplace" className="mb-4 inline-block text-sm text-brand-600 hover:underline">
        ← Marketplace
      </Link>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">Load details</h2>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Detail label="Origin" value={`${load.origin.city}, ${load.origin.state}`} />
              <Detail label="Destination" value={`${load.destination.city}, ${load.destination.state}`} />
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
            <h2 className="mb-3 text-sm font-semibold text-ink">Make an offer</h2>
            {thread ? (
              <p className="text-sm text-muted">
                You have an {thread.status === "ACTIVE" ? "active" : titleCase(thread.status)}{" "}
                negotiation on this load. Manage it on the left.
              </p>
            ) : load.eligibility.eligible ? (
              <CreateOfferForm loadId={load.id} />
            ) : (
              <Alert tone="info">
                You cannot offer on this load:
                <ul className="mt-1 list-disc pl-5">
                  {load.eligibility.reasons.map((r) => (
                    <li key={r}>{REASON_LABEL[r] ?? titleCase(r)}</li>
                  ))}
                </ul>
              </Alert>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
