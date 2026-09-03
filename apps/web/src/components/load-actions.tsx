"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { LoadView } from "@loadtopia/shared";
import { ApiError, apiClient } from "@/lib/api-client";
import { Alert, Button, Spinner } from "./ui";

export function LoadActions({ load }: { load: LoadView }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          <Button onClick={() => run("post", "POST")} disabled={busy !== null}>
            {busy === "post" && <Spinner />} Post load
          </Button>
        )}
        {canUnpost && (
          <Button variant="secondary" onClick={() => run("unpost", "POST")} disabled={busy !== null}>
            {busy === "unpost" && <Spinner />} Withdraw to draft
          </Button>
        )}
        {canCancel && (
          <Button
            variant="danger"
            onClick={() => {
              const reason = window.prompt("Reason for cancelling (optional):") ?? undefined;
              run("cancel", "POST", reason ? { reason } : undefined);
            }}
            disabled={busy !== null}
          >
            {busy === "cancel" && <Spinner />} Cancel load
          </Button>
        )}
        {canDelete && (
          <Button
            variant="danger"
            onClick={() => {
              if (window.confirm("Delete this draft load permanently?")) run("delete", "DELETE");
            }}
            disabled={busy !== null}
          >
            {busy === "delete" && <Spinner />} Delete
          </Button>
        )}
      </div>
      {load.status === "POSTED" && (
        <p className="text-xs text-muted">
          This load is posted. Withdraw it to a draft to make changes.
        </p>
      )}
    </div>
  );
}
