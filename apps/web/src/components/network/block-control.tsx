"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CompanyBlockStatus } from "@loadtopia/shared";
import { ApiError, apiClient } from "@/lib/api-client";
import { ConfirmDialog } from "@/components/dialog";
import { Alert, Badge, Button } from "@/components/ui";
import { BLOCK_STATUS_TONE } from "@/lib/status-tone";

/**
 * PRIVATE, company-primary/admin only, visually separated as a
 * destructive/future-control action — never a single accidental click.
 * `blockStatus` here is always the VIEWER's own block against the other
 * company; the other company's experience is never shown or implied here.
 */
export function BlockControl({
  companyId,
  canManage,
  initialStatus,
}: {
  companyId: string;
  canManage: boolean;
  initialStatus: CompanyBlockStatus | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<"block" | "unblock" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function block() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient<{ status: CompanyBlockStatus }>(`/companies/${companyId}/block`, {
        method: "POST",
      });
      setStatus(res.status);
      setConfirming(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not block this company");
    } finally {
      setBusy(false);
    }
  }

  async function unblock() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient<{ status: CompanyBlockStatus }>(`/companies/${companyId}/unblock`, {
        method: "POST",
      });
      setStatus(res.status === "INACTIVE" ? null : res.status);
      setConfirming(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not unblock this company");
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) return null;

  const isBlocked = status === "ACTIVE" || status === "PENDING_ON_COMPLETION";

  return (
    <div className="space-y-2 rounded-lg border border-red-100 bg-red-50/40 p-3">
      {error && <Alert>{error}</Alert>}
      {isBlocked ? (
        <>
          <p className="text-sm text-ink">
            <Badge tone={BLOCK_STATUS_TONE[status!]}>
              {status === "ACTIVE" ? "Blocked" : "Block pending completion"}
            </Badge>
          </p>
          <p className="text-xs text-muted">
            {status === "PENDING_ON_COMPLETION"
              ? "Future blocking is pending. Existing freight must remain accessible until it is completed."
              : "Future interaction with this company is restricted."}
          </p>
          <Button variant="secondary" onClick={() => setConfirming("unblock")} disabled={busy}>
            Unblock
          </Button>
        </>
      ) : (
        <Button variant="danger" onClick={() => setConfirming("block")} disabled={busy}>
          Block this company
        </Button>
      )}

      <ConfirmDialog
        open={confirming === "block"}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="Block this company?"
        description="This is private — the other company is never told. Future interaction will be restricted. If freight is currently active between your companies, the block takes effect once that freight is completed; existing freight keeps working normally until then."
        confirmLabel="Block"
        tone="danger"
        busy={busy}
        onConfirm={block}
      />

      <ConfirmDialog
        open={confirming === "unblock"}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="Unblock this company?"
        description="Future interaction will no longer be restricted. This does not erase the record that a block previously existed."
        confirmLabel="Unblock"
        busy={busy}
        onConfirm={unblock}
      />
    </div>
  );
}
