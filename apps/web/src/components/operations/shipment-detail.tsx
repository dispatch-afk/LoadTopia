import type { ReactNode } from "react";
import type { CheckInView, DocumentView, LoadView, RateConfirmationView } from "@loadtopia/shared";
import { Card } from "@/components/ui";
import { customerFacingStage } from "@/lib/operations";
import { fmtDriveTime, fmtMiles, fmtWeight, fmtWindow, titleCase } from "@/lib/format";
import { ShipmentProgress } from "./shipment-progress";
import { CheckInsPanel } from "./check-ins-panel";
import { DocumentsPanel } from "./documents-panel";
import { ShipmentTimeline } from "./shipment-timeline";
import { ShipmentAgreementCard } from "./shipment-agreement-card";

function Detail({ label, value }: { label: string; value: ReactNode }) {
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

/**
 * The shared, role-aware operational Shipment Detail (Milestone 4 Phase 6).
 * Used by BOTH the shipper (`/loads/:id`) and the assigned carrier
 * (`/marketplace/:id`) once a load is operational (CARRIER_ASSIGNED or
 * later, or a historical AWARDED-only legacy record) — the SAME Load domain
 * record, no separate Shipment entity, no new route.
 *
 * This composes EXISTING shared operational components (ShipmentProgress,
 * CheckInsPanel, DocumentsPanel, ShipmentTimeline, ShipmentAgreementCard)
 * rather than re-implementing any of their business rules — every
 * authorization/next-action fact it displays is server-computed and merely
 * rendered here. Role-specific controls (carrier movement actions, shipper
 * completion, legacy assignment) are NOT part of this component — the
 * caller passes them in as `actions`, keeping genuinely different
 * capabilities genuinely distinct (see CarrierShipmentActions/LoadActions/
 * ShipperCompleteAction/AssignCarrierButton).
 *
 * Privacy note: `load.events` arrives here ALREADY redacted by the API for
 * a carrier viewer (see toEventView in loads.serializer.ts) — this
 * component never makes its own privacy decisions.
 */
export function ShipmentDetail({
  load,
  checkIns,
  documents,
  rateConfirmation,
  viewerCompanyId,
  canRecordCheckIn,
  canUploadDocument,
  canReviewPod,
  actions,
}: {
  load: LoadView;
  checkIns: CheckInView[];
  documents: DocumentView[];
  rateConfirmation: RateConfirmationView | "unavailable" | null;
  /** The signed-in viewer's own active company id — used only to label "Your
   *  company" vs. "Shipper"/"Carrier" in the Documents list. */
  viewerCompanyId: string | null;
  canRecordCheckIn: boolean;
  canUploadDocument: boolean;
  canReviewPod: boolean;
  actions: ReactNode;
}) {
  const stage = customerFacingStage(load, documents);
  const award = load.marketplace.award;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {/* Where it is → what happens next → who's responsible. */}
        <Card className="p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                Current stage
              </p>
              <p className="mt-0.5 text-base font-semibold text-ink">{stage}</p>
            </div>
            {load.shipmentNextAction && (
              <div className="text-right">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  Next action
                </p>
                <p className="mt-0.5 text-base font-semibold text-brand-700">
                  {load.shipmentNextAction}
                </p>
              </div>
            )}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4 text-sm">
            <Detail label="Shipper" value={load.shipperName} />
            <Detail label="Carrier" value={award?.carrierName ?? "—"} />
          </dl>
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-ink">Shipment progress</h2>
          <ShipmentProgress load={load} />
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-ink">Route &amp; freight</h2>
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
            <Detail label="Est. drive time" value={fmtDriveTime(load.routing.driveTimeMinutes)} />
          </dl>
          {load.routing.provider && (
            <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
              Routing via <code>{load.routing.provider}</code> provider
              {load.routing.isMock && " — MOCK development data, not real-world routing"}
            </p>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-ink">Check-ins</h2>
          <CheckInsPanel loadId={load.id} checkIns={checkIns} canRecord={canRecordCheckIn} />
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-ink">Documents</h2>
          <DocumentsPanel
            loadId={load.id}
            documents={documents}
            shipperCompanyId={load.shipperCompanyId}
            activeCompanyId={viewerCompanyId}
            canUpload={canUploadDocument}
            canReview={canReviewPod}
          />
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-ink">Timeline</h2>
          <ShipmentTimeline events={load.events} />
        </Card>
      </div>

      <div className="space-y-6">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Actions</h2>
          {actions}
        </Card>

        {award && (
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">Commercial agreement</h2>
            <ShipmentAgreementCard
              loadId={load.id}
              award={award}
              rateConfirmation={rateConfirmation}
            />
          </Card>
        )}
      </div>
    </div>
  );
}
