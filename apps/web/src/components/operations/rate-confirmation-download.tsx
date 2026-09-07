"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RateConfirmationView } from "@loadtopia/shared";
import { ApiError, apiClient } from "@/lib/api-client";
import { Alert, Button, Spinner } from "@/components/ui";

/**
 * Downloads the LoadTopia-generated Rate Confirmation PDF. The signed URL is
 * short-lived, so it is requested fresh on click and used immediately — never
 * persisted or embedded in the page.
 */
export function RateConfirmationDownload({
  loadId,
  pending,
}: {
  loadId: string;
  pending: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const rc = await apiClient<RateConfirmationView>(`/loads/${loadId}/rate-confirmation`);
      if (rc.download?.url) {
        window.open(rc.download.url, "_blank", "noopener");
        router.refresh();
      } else {
        setError("The Rate Confirmation PDF is not ready yet. Try again shortly.");
        router.refresh();
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setError("Document storage is temporarily unavailable. Please try again.");
      } else {
        setError(err instanceof ApiError ? err.message : "Could not fetch the Rate Confirmation");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {error && <Alert>{error}</Alert>}
      <Button variant={pending ? "secondary" : "primary"} onClick={download} disabled={busy}>
        {busy && <Spinner />} {pending ? "Check again" : "Download PDF"}
      </Button>
    </div>
  );
}
