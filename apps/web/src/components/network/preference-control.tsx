"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CarrierPreferenceType } from "@loadtopia/shared";
import { ApiError, apiClient } from "@/lib/api-client";
import { Alert, Button, Spinner } from "@/components/ui";

const LABEL: Record<CarrierPreferenceType, string> = {
  PREFER: "Prefer",
  DO_NOT_PREFER: "Do Not Prefer",
};

/**
 * SHIPPER-ONLY, company-primary/admin only, and entirely PRIVATE — the
 * carrier never sees this control or its state. Not a rating, not a
 * certification: Prefer doesn't mean approved or better-performing, and Do
 * Not Prefer doesn't disconnect, block, or assign fault.
 */
export function PreferenceControl({
  carrierCompanyId,
  canManage,
  initialPreference,
}: {
  carrierCompanyId: string;
  canManage: boolean;
  initialPreference: CarrierPreferenceType | null;
}) {
  const router = useRouter();
  const [preference, setPreference] = useState(initialPreference);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(next: CarrierPreferenceType) {
    setBusy(true);
    setError(null);
    try {
      await apiClient(`/companies/${carrierCompanyId}/preference`, {
        method: "PUT",
        body: JSON.stringify({ preference: next }),
      });
      setPreference(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the preference");
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setError(null);
    try {
      await apiClient(`/companies/${carrierCompanyId}/preference`, { method: "DELETE" });
      setPreference(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not clear the preference");
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) {
    return preference ? (
      <p className="text-sm text-ink">{LABEL[preference]}</p>
    ) : (
      <p className="text-sm text-muted">No preference set</p>
    );
  }

  return (
    <div className="space-y-2">
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={preference === "PREFER" ? "primary" : "secondary"}
          onClick={() => set("PREFER")}
          disabled={busy}
        >
          {busy && <Spinner />} Prefer
        </Button>
        <Button
          variant={preference === "DO_NOT_PREFER" ? "primary" : "secondary"}
          onClick={() => set("DO_NOT_PREFER")}
          disabled={busy}
        >
          Do Not Prefer
        </Button>
        {preference && (
          <Button variant="ghost" onClick={clear} disabled={busy}>
            Clear
          </Button>
        )}
      </div>
      <p className="text-xs text-muted">
        Private to your company. This is an internal note, never a rating — the carrier can never see it, and it
        does not affect freight access.
      </p>
    </div>
  );
}
