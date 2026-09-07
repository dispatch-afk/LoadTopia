"use client";

import { useState } from "react";
import type { DocumentDownloadView } from "@loadtopia/shared";
import { ApiError, apiClient } from "@/lib/api-client";
import { Spinner } from "@/components/ui";
import { documentErrorMessage } from "@/lib/document-upload";

/**
 * Requests a FRESH short-lived signed download URL on click and opens it
 * immediately. The URL is never stored, never rendered into the page, and never
 * put in browser storage — every download is a new request.
 */
export function DocumentDownloadLink({ documentId }: { documentId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await apiClient<DocumentDownloadView>(
        `/load-documents/${documentId}/download`,
      );
      window.open(url, "_blank", "noopener");
    } catch (err) {
      if (err instanceof ApiError && err.code === "DOCUMENT_OBJECT_MISSING") {
        setError("This file is no longer available in storage.");
      } else {
        setError(documentErrorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={download}
        disabled={busy}
        className="lt-focus inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline disabled:opacity-50"
      >
        {busy && <Spinner />} Download
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
