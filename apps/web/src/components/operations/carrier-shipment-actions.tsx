"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { LoadView } from "@loadtopia/shared";
import { ApiError, apiClient } from "@/lib/api-client";
import { Alert, Button, Spinner } from "@/components/ui";
import { carrierMovementAction } from "@/lib/operations";

/**
 * The assigned carrier's operational movement action for the current state,
 * taken from `load.availableTransitions` (already actor-filtered by the API):
 * Confirm pickup → Start transit → Mark delivered. There is deliberately no
 * Complete action here — completion is the shipper's, after POD approval.
 *
 * "Mark delivered" carries a confirmation making clear it records PHYSICAL
 * delivery only.
 */
export function CarrierShipmentActions({ load }: { load: LoadView }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const action = carrierMovementAction(load);
  if (!action) {
    if (load.status === "DELIVERED") {
      return (
        <p className="text-sm text-muted">
          Delivery recorded. POD review and completion are handled by the shipper.
        </p>
      );
    }
    if (load.status === "COMPLETED") {
      return <p className="text-sm text-muted">This shipment is complete.</p>;
    }
    if (load.status === "CANCELLED") {
      return <p className="text-sm text-muted">This shipment was cancelled.</p>;
    }
    return <p className="text-sm text-muted">No actions available right now.</p>;
  }

  async function run() {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient(`/loads/${load.id}/${action.endpoint}`, { method: "POST" });
      setConfirming(false);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("This shipment changed. The page has been refreshed — check the current status.");
        router.refresh();
      } else {
        setError(err instanceof ApiError ? err.message : "Could not update the shipment");
      }
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && <Alert>{error}</Alert>}

      {action.confirm && confirming ? (
        <div className="space-y-3 rounded-lg border border-line bg-canvas p-3">
          <p className="text-sm text-ink">{action.confirm}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={run} disabled={busy}>
              {busy && <Spinner />} {action.label}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          onClick={() => (action.confirm ? setConfirming(true) : run())}
          disabled={busy}
          className="w-full sm:w-auto"
        >
          {busy && <Spinner />} {action.label}
        </Button>
      )}
    </div>
  );
}
