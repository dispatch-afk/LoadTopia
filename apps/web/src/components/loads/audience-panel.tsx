"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LoadView } from "@loadtopia/shared";
import { ApiError, apiClient } from "@/lib/api-client";
import { Alert, Badge, Button, Spinner } from "@/components/ui";
import { ConfirmDialog } from "@/components/dialog";
import { AUDIENCE_STAGE_LABEL, AUDIENCE_STRATEGY_LABEL } from "@/lib/audience";
import { fmtExactDateTime } from "@/lib/format";

/**
 * Shipper-only audience state + controls for the Load detail / coverage
 * workspace. Renders nothing for a DRAFT load or a pre-Phase-4 legacy
 * posted load (no recorded strategy) — see LoadView.audience's doc comment.
 */
export function AudiencePanel({ load, canManage }: { load: LoadView; canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<"NETWORK" | "MARKETPLACE" | null>(null);
  const [rescheduling, setRescheduling] = useState<string | null>(null);
  const [rescheduleAt, setRescheduleAt] = useState("");
  const [cancelling, setCancelling] = useState<string | null>(null);

  if (!load.audience) return null;
  const a = load.audience;
  const nextRelease = a.pendingReleases[0] ?? null;
  const eligible = load.status === "POSTED" || load.status === "OFFER_RECEIVED";

  async function releaseNow(target: "NETWORK" | "MARKETPLACE") {
    setBusy("release");
    setError(null);
    try {
      await apiClient(`/loads/${load.id}/release-now`, {
        method: "POST",
        body: JSON.stringify({ target }),
      });
      setConfirmTarget(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not release now");
    } finally {
      setBusy(null);
    }
  }

  async function submitReschedule(releaseId: string) {
    if (!rescheduleAt) return;
    setBusy("reschedule");
    setError(null);
    try {
      await apiClient(`/loads/${load.id}/audience-releases/${releaseId}/reschedule`, {
        method: "POST",
        body: JSON.stringify({ releaseAt: new Date(rescheduleAt).toISOString() }),
      });
      setRescheduling(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reschedule");
    } finally {
      setBusy(null);
    }
  }

  async function confirmCancel(releaseId: string) {
    setBusy("cancel");
    setError(null);
    try {
      await apiClient(`/loads/${load.id}/audience-releases/${releaseId}/cancel`, { method: "POST" });
      setCancelling(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not cancel the scheduled release");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-ink">Audience</h2>
      {error && (
        <div className="mb-3">
          <Alert>{error}</Alert>
        </div>
      )}
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-xs uppercase text-muted">Original strategy</dt>
          <dd>{AUDIENCE_STRATEGY_LABEL[a.strategy]}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-muted">Current audience</dt>
          <dd>
            <Badge tone="indigo">{AUDIENCE_STAGE_LABEL[a.currentStage]}</Badge>
            {a.audienceCount != null && (
              <span className="ml-2 text-muted">
                {a.audienceCount} carrier{a.audienceCount === 1 ? "" : "s"}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-muted">Next scheduled release</dt>
          <dd>
            {nextRelease ? (
              <>
                {AUDIENCE_STAGE_LABEL[nextRelease.toStage]} on{" "}
                <span className="font-medium">{fmtExactDateTime(nextRelease.scheduledAt)}</span>
              </>
            ) : a.autoReleaseDisabled ? (
              "Automatic release is off"
            ) : (
              "No further release scheduled"
            )}
          </dd>
        </div>
      </dl>

      {canManage && eligible && a.currentStage !== "MARKETPLACE" && (
        <div className="mt-4 space-y-2 border-t border-line pt-4">
          {a.currentStage === "SELECTED" && (
            <Button
              variant="secondary"
              className="w-full justify-center"
              disabled={busy !== null}
              onClick={() => setConfirmTarget("NETWORK")}
            >
              Release to Carrier Network now
            </Button>
          )}
          <Button
            variant="secondary"
            className="w-full justify-center"
            disabled={busy !== null}
            onClick={() => setConfirmTarget("MARKETPLACE")}
          >
            Release to Marketplace now
          </Button>

          {nextRelease && (
            <div className="space-y-2 pt-1">
              {rescheduling === nextRelease.id ? (
                <div className="space-y-2 rounded-lg border border-line p-3">
                  <input
                    type="datetime-local"
                    className="w-full rounded-lg border border-line px-3 py-1.5 text-sm"
                    value={rescheduleAt}
                    onChange={(e) => setRescheduleAt(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button
                      className="flex-1 justify-center"
                      disabled={busy !== null || !rescheduleAt}
                      onClick={() => submitReschedule(nextRelease.id)}
                    >
                      {busy === "reschedule" && <Spinner />} Save
                    </Button>
                    <Button
                      variant="secondary"
                      className="flex-1 justify-center"
                      onClick={() => setRescheduling(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    className="flex-1 justify-center"
                    disabled={busy !== null}
                    onClick={() => setRescheduling(nextRelease.id)}
                  >
                    Reschedule
                  </Button>
                  <Button
                    variant="danger"
                    className="flex-1 justify-center"
                    disabled={busy !== null}
                    onClick={() => setCancelling(nextRelease.id)}
                  >
                    Cancel release
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => !open && setConfirmTarget(null)}
        title={`Release to ${confirmTarget ? AUDIENCE_STAGE_LABEL[confirmTarget] : ""} now?`}
        description="This widens the audience immediately. Any other pending scheduled release for this load will be cancelled."
        confirmLabel="Release now"
        busy={busy === "release"}
        onConfirm={() => confirmTarget && releaseNow(confirmTarget)}
      />

      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => !open && setCancelling(null)}
        title="Cancel this scheduled release?"
        description="Automatic release will be turned off for this load. You can still release manually at any time."
        confirmLabel="Cancel release"
        tone="danger"
        busy={busy === "cancel"}
        onConfirm={() => cancelling && confirmCancel(cancelling)}
      />
    </div>
  );
}
