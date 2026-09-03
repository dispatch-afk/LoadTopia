"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, apiClient } from "@/lib/api-client";
import { Alert, Button, Spinner } from "./ui";

/** Shipper confirms the awarded carrier: AWARDED → CARRIER_ASSIGNED. */
export function AssignCarrierButton({ loadId }: { loadId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function assign() {
    setBusy(true);
    setError(null);
    try {
      await apiClient(`/loads/${loadId}/assign`, { method: "POST" });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not assign carrier");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {error && <Alert>{error}</Alert>}
      <Button onClick={assign} disabled={busy}>
        {busy && <Spinner />} Confirm carrier assignment
      </Button>
    </div>
  );
}
