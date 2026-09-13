"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { LoadView } from "@loadtopia/shared";
import { ApiError, apiClient } from "@/lib/api-client";
import { ConfirmDialog, PromptDialog } from "./dialog";
import { Alert, Button, Spinner } from "./ui";

export function LoadActions({ load }: { load: LoadView }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function run(action: string, method: "POST" | "DELETE", body?: unknown) {
    setBusy(action);
    setError(null);
    try {
      await apiClient(`/loads/${load.id}${action === "delete" ? "" : `/${action}`}`, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (action === "delete") {
        router.push("/loads");
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
      setBusy(null);
    }
  }

  const canPost = load.availableTransitions.includes("POSTED");
  const canUnpost = load.status === "POSTED" && load.availableTransitions.includes("DRAFT");
  const canCancel = load.availableTransitions.includes("CANCELLED");
  const canEdit = load.status === "DRAFT";
  const canDelete = load.status === "DRAFT";
  const canEstimate = load.status === "DRAFT" || load.status === "POSTED";

  async function estimate() {
    setBusy("estimate");
    setError(null);
    try {
      await apiClient("/pricing/estimate", {
        method: "POST",
        body: JSON.stringify({ loadId: load.id }),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not get an estimate");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <Link href={`/loads/${load.id}/edit`}>
            <Button variant="secondary">Edit</Button>
          </Link>
        )}
        {canPost && (
          <Link href={`/loads/${load.id}/review`}>
            <Button disabled={busy !== null}>Review & Post</Button>
          </Link>
        )}
        {canUnpost && (
          <Button variant="secondary" onClick={() => run("unpost", "POST")} disabled={busy !== null}>
            {busy === "unpost" && <Spinner />} Withdraw to draft
          </Button>
        )}
        {canCancel && (
          <Button variant="danger" onClick={() => setCancelling(true)} disabled={busy !== null}>
            {busy === "cancel" && <Spinner />} Cancel load
          </Button>
        )}
        {canDelete && (
          <Button variant="danger" onClick={() => setDeleting(true)} disabled={busy !== null}>
            {busy === "delete" && <Spinner />} Delete
          </Button>
        )}
        {canEstimate && (
          <Button variant="secondary" onClick={estimate} disabled={busy !== null}>
            {busy === "estimate" && <Spinner />} Get pricing estimate
          </Button>
        )}
      </div>
      {load.status === "POSTED" && (
        <p className="text-xs text-muted">
          This load is posted. Withdraw it to a draft to make changes.
        </p>
      )}

      <PromptDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title="Cancel this load?"
        description="This cannot be undone. You may optionally record why."
        label="Reason for cancelling (optional)"
        placeholder="e.g. Customer no longer needs this shipment"
        submitLabel="Cancel load"
        cancelLabel="Keep load"
        busy={busy === "cancel"}
        onSubmit={(reason) => {
          setCancelling(false);
          run("cancel", "POST", reason ? { reason } : undefined);
        }}
      />

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this draft load?"
        description="This permanently deletes the load. This cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        busy={busy === "delete"}
        onConfirm={() => {
          setDeleting(false);
          run("delete", "DELETE");
        }}
      />
    </div>
  );
}
