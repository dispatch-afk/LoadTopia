"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { LoadView } from "@loadtopia/shared";
import { ApiError, apiClient } from "@/lib/api-client";
import { Alert, Button, Spinner } from "@/components/ui";
import { canCompleteShipment, completionBlockedReason } from "@/lib/operations";

/**
 * Owning-shipper DELIVERED → COMPLETED. Offered ONLY when the backend's
 * actor-aware `availableTransitions` includes COMPLETED — never merely because
 * the load is DELIVERED. When it is delivered but not yet completable, the
 * reason (no approved POD) is shown as a normal next step, not an error.
 */
export function ShipperCompleteAction({ load }: { load: LoadView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blockedReason = completionBlockedReason(load);

  if (!canCompleteShipment(load)) {
    if (blockedReason) {
      return (
        <p className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-muted">
          {blockedReason}
        </p>
      );
    }
    return null;
  }

  async function complete() {
    if (!window.confirm("Mark this shipment completed? This closes out the load.")) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient(`/loads/${load.id}/complete`, { method: "POST" });
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(
          "This shipment is not ready to complete. The page has been refreshed with the current state.",
        );
        router.refresh();
      } else {
        setError(err instanceof ApiError ? err.message : "Could not complete the shipment");
      }
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {error && <Alert>{error}</Alert>}
      <Button onClick={complete} disabled={busy}>
        {busy && <Spinner />} Complete shipment
      </Button>
    </div>
  );
}
