import type { CheckInView } from "@loadtopia/shared";
import { fmtDateTime } from "@/lib/format";
import { formatReportedCoordinates } from "@/lib/operations";
import { CheckInForm } from "./check-in-form";

/**
 * Manual check-in history + (for the operating carrier) the entry form. These
 * are self-reported city/state observations — never GPS, live location, or a
 * verified position, and the copy here says so.
 */
export function CheckInsPanel({
  loadId,
  checkIns,
  canRecord,
}: {
  loadId: string;
  checkIns: CheckInView[];
  canRecord: boolean;
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Manual check-ins are entered by the carrier. They are reported locations, not GPS or live
        tracking.
      </p>

      {checkIns.length === 0 ? (
        <p className="text-sm text-muted">No check-ins recorded yet.</p>
      ) : (
        <ol className="space-y-3">
          {checkIns.map((c) => {
            const coords = formatReportedCoordinates(c.latitude, c.longitude);
            return (
              <li key={c.id} className="flex gap-3 text-sm">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-400" aria-hidden />
                <div className="min-w-0">
                  <p className="text-ink">
                    {c.city}, {c.state}
                  </p>
                  {c.note && <p className="text-muted">“{c.note}”</p>}
                  <p className="text-xs text-muted">
                    Manual check-in · {fmtDateTime(c.recordedAt)}
                    {coords && <> · reported location {coords}</>}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {canRecord && (
        <div className="border-t border-line pt-4">
          <h3 className="mb-3 text-sm font-semibold text-ink">Record a check-in</h3>
          <CheckInForm loadId={loadId} />
        </div>
      )}
    </div>
  );
}
