"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, apiClient } from "@/lib/api-client";
import { ConfirmDialog } from "@/components/dialog";
import { Alert, Button, Field, Spinner, Textarea } from "@/components/ui";

/**
 * Owning-shipper POD review for a PENDING_REVIEW document. Approve is a plain
 * confirm; Reject requires a non-empty reason (the backend enforces it too).
 * After either, the load detail is refreshed because `completionReady` — and
 * therefore the Complete action — may change.
 */
export function PodReviewActions({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "rejecting">("idle");
  const [reason, setReason] = useState("");
  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setBusy("approve");
    setError(null);
    try {
      await apiClient(`/load-documents/${documentId}/approve`, { method: "POST" });
      setConfirmingApprove(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not approve the POD");
      setBusy(null);
    }
  }

  async function reject(e: React.FormEvent) {
    e.preventDefault();
    setBusy("reject");
    setError(null);
    try {
      await apiClient(`/load-documents/${documentId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reject the POD");
      setBusy(null);
    }
  }

  return (
    <div className="mt-2 space-y-2">
      {error && <Alert>{error}</Alert>}

      {mode === "idle" ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setConfirmingApprove(true)} disabled={busy !== null}>
            {busy === "approve" && <Spinner />} Approve POD
          </Button>
          <Button variant="danger" onClick={() => setMode("rejecting")} disabled={busy !== null}>
            Reject POD
          </Button>
          <ConfirmDialog
            open={confirmingApprove}
            onOpenChange={setConfirmingApprove}
            title="Approve this POD?"
            description="This finalises the proof of delivery."
            confirmLabel="Approve"
            busy={busy === "approve"}
            onConfirm={approve}
          />
        </div>
      ) : (
        <form onSubmit={reject} className="space-y-2">
          <Field label="Reason for rejection" required>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              placeholder="e.g. Signature illegible; delivery date missing"
              autoFocus
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" disabled={busy !== null || reason.trim() === ""}>
              {busy === "reject" && <Spinner />} Confirm rejection
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setMode("idle");
                setReason("");
              }}
              disabled={busy !== null}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
