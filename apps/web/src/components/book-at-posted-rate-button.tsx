"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, apiClient } from "@/lib/api-client";
import { fmtMoney } from "@/lib/format";
import { Alert, Button, Spinner } from "./ui";
import { ConfirmDialog } from "./dialog";

/**
 * Binding commercial acceptance of a shipper's posted rate (Milestone 4
 * Phase 5). `confirmedRate` is sent back to the server exactly as displayed
 * here — the server independently re-reads the authoritative posted rate
 * inside the award transaction and rejects with a truthful "terms changed"
 * outcome if it no longer matches; what the carrier saw is never authority.
 */
export function BookAtPostedRateButton({
  loadId,
  postedRate,
}: {
  loadId: string;
  postedRate: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function book() {
    setBusy(true);
    setError(null);
    try {
      await apiClient(`/marketplace/loads/${loadId}/book`, {
        method: "POST",
        body: JSON.stringify({ confirmedRate: postedRate }),
      });
      setConfirming(false);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "COMMERCIAL_TERMS_CHANGED") {
        setError("The commercial terms for this load changed. Refreshing…");
        router.refresh();
      } else if (err instanceof ApiError && err.code === "CONFLICT") {
        setError("This load has already been covered by another carrier.");
        router.refresh();
      } else {
        setError(err instanceof ApiError ? err.message : "Could not book this load");
      }
      setBusy(false);
    }
  }

  return (
    <>
      {error && (
        <div className="mb-2">
          <Alert>{error}</Alert>
        </div>
      )}
      <Button onClick={() => setConfirming(true)} disabled={busy}>
        {busy && <Spinner />} Book at {fmtMoney(postedRate)}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Book this load?"
        description={`This is binding commercial acceptance. You will book this load for ${fmtMoney(postedRate)}.`}
        confirmLabel={`Book for ${fmtMoney(postedRate)}`}
        busy={busy}
        onConfirm={book}
      />
    </>
  );
}
