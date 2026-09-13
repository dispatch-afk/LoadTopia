"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ConnectionView } from "@loadtopia/shared";
import { ApiError, apiClient } from "@/lib/api-client";
import { ConfirmDialog } from "@/components/dialog";
import { Alert, Button } from "@/components/ui";

/**
 * Accept / Decline a PENDING request awaiting this company's response, or
 * Disconnect an ACCEPTED connection. Only rendered with `canManage=true` by
 * the caller (company-primary/admin) — the API re-enforces regardless, so
 * an ordinary member who somehow triggers this still gets a clean 403.
 */
export function ConnectionActions({
  connection,
  canManage,
  counterpartNoun,
}: {
  connection: ConnectionView;
  canManage: boolean;
  counterpartNoun: "carrier" | "shipper";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "decline" | "disconnect" | null>(null);
  const [confirming, setConfirming] = useState<"accept" | "decline" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "accept" | "decline" | "disconnect") {
    setBusy(action);
    setError(null);
    try {
      await apiClient(`/connections/${connection.id}/${action}`, { method: "POST" });
      setConfirming(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't go through — try again");
      setBusy(null);
    }
  }

  const pendingAsRequester = connection.status === "PENDING" && !connection.awaitingMyResponse;

  if (!canManage) {
    if (connection.status === "PENDING" && connection.awaitingMyResponse) {
      return <p className="text-sm text-muted">Awaiting a company admin&rsquo;s response.</p>;
    }
    if (pendingAsRequester) {
      return <p className="text-sm text-muted">Waiting for the other company to respond.</p>;
    }
    return null;
  }

  return (
    <div className="space-y-2">
      {error && <Alert>{error}</Alert>}

      {pendingAsRequester && <p className="text-sm text-muted">Waiting for the other company to respond.</p>}

      {connection.status === "PENDING" && connection.awaitingMyResponse && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setConfirming("accept")} disabled={busy !== null}>
            Accept
          </Button>
          <Button variant="secondary" onClick={() => setConfirming("decline")} disabled={busy !== null}>
            Decline
          </Button>
        </div>
      )}

      {connection.status === "ACCEPTED" && (
        <Button variant="danger" onClick={() => setConfirming("disconnect")} disabled={busy !== null}>
          Disconnect
        </Button>
      )}

      <ConfirmDialog
        open={confirming === "accept"}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="Connect these companies?"
        description={`You are connecting your company and this ${counterpartNoun} as business partners in LoadTopia. Connecting does not automatically give this company access to all of your freight.`}
        confirmLabel="Connect"
        busy={busy === "accept"}
        onConfirm={() => run("accept")}
      />

      <ConfirmDialog
        open={confirming === "decline"}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="Decline this connection request?"
        description="The requesting company will see that the request was declined. No reason is shared."
        confirmLabel="Decline"
        tone="danger"
        busy={busy === "decline"}
        onConfirm={() => run("decline")}
      />

      <ConfirmDialog
        open={confirming === "disconnect"}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="Disconnect this relationship?"
        description="Future Carrier Network access between your companies ends. Historical transactions, documents, and commercial records are not deleted, and freight already in progress continues under the existing operational rules. This is different from a block."
        confirmLabel="Disconnect"
        tone="danger"
        busy={busy === "disconnect"}
        onConfirm={() => run("disconnect")}
      />
    </div>
  );
}
