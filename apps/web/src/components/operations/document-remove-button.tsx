"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, apiClient } from "@/lib/api-client";
import { Spinner } from "@/components/ui";
import { documentErrorMessage } from "@/lib/document-upload";

/**
 * Soft-removes a document the current company uploaded. Only offered for
 * documents the backend would actually let this actor remove (never a reviewed
 * POD); the backend re-enforces regardless. A secondary action, behind a
 * confirm.
 */
export function DocumentRemoveButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm("Remove this document? It will no longer be listed on the shipment.")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiClient(`/load-documents/${documentId}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? documentErrorMessage(err) : "Could not remove the document");
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className="lt-focus inline-flex items-center gap-1.5 text-sm text-muted hover:text-red-600 disabled:opacity-50"
      >
        {busy && <Spinner />} Remove
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
