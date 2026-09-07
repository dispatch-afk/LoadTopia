import type { RateConfirmationView } from "@loadtopia/shared";
import { fmtDateTime, titleCase } from "@/lib/format";
import { RateConfirmationDownload } from "./rate-confirmation-download";

function money(v: string, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(v));
}

/**
 * Rate Confirmation section. `state` is the backend's truth:
 *   - a view with `download` -> generated + downloadable
 *   - a view with `documentPending` -> being prepared (not an error)
 *   - "unavailable" -> a load awarded before this feature shipped
 * The commercial terms are never recomputed client-side; only the immutable
 * generated artifact is offered.
 */
export function RateConfirmationPanel({
  loadId,
  state,
}: {
  loadId: string;
  state: RateConfirmationView | "unavailable";
}) {
  if (state === "unavailable") {
    return (
      <p className="text-sm text-muted">
        A Rate Confirmation is not available for this load — it was awarded before LoadTopia began
        generating them.
      </p>
    );
  }

  const rc = state;
  const ready = rc.download !== null;

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">Agreed rate</dt>
          <dd className="mt-0.5 text-ink">{money(rc.agreedRate, rc.currency)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">Carrier</dt>
          <dd className="mt-0.5 text-ink">{rc.carrier.companyName}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">Awarded</dt>
          <dd className="mt-0.5 text-ink">{fmtDateTime(rc.awardedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">Document</dt>
          <dd className="mt-0.5 text-ink">{titleCase(rc.status)}</dd>
        </div>
      </dl>

      {ready ? (
        <RateConfirmationDownload loadId={loadId} pending={false} />
      ) : (
        <div className="space-y-2">
          <p className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-muted">
            The Rate Confirmation PDF is being prepared. The commercial agreement is already in
            effect — this only affects the downloadable copy.
          </p>
          <RateConfirmationDownload loadId={loadId} pending={true} />
        </div>
      )}
    </div>
  );
}
