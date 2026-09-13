"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ConnectionView } from "@loadtopia/shared";
import { ApiError, apiClient } from "@/lib/api-client";
import { Alert, Button, Spinner } from "@/components/ui";

/**
 * Any active member may request a Connection — a lightweight, non-binding
 * action (no confirmation dialog; the result is never ambiguous, since the
 * button label itself becomes the confirmation). Does not imply acceptance
 * or auto-connect.
 */
export function ConnectToggle({
  companyId,
  connection,
  counterpartNoun,
}: {
  companyId: string;
  connection: ConnectionView | null;
  counterpartNoun: "carrier" | "shipper";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function request() {
    setBusy(true);
    setError(null);
    try {
      await apiClient(`/companies/${companyId}/connections`, { method: "POST" });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send the connection request");
    } finally {
      setBusy(false);
    }
  }

  if (connection?.status === "ACCEPTED") {
    return <Button variant="secondary" disabled>Connected</Button>;
  }
  if (connection?.status === "PENDING") {
    return (
      <Button variant="secondary" disabled>
        {connection.awaitingMyResponse ? "Respond to request below" : "Connection requested"}
      </Button>
    );
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button onClick={request} disabled={busy}>
        {busy && <Spinner />} Connect
      </Button>
      {error && <Alert>{error}</Alert>}
      <span className="text-xs text-muted">Send a connection request to this {counterpartNoun}.</span>
    </span>
  );
}
