import type { LoadEventView } from "@loadtopia/shared";
import { LOAD_EVENT_LABELS } from "@/lib/operations";
import { fmtDateTime, titleCase } from "@/lib/format";

/**
 * Immutable `load.events` history, extracted from the shipper detail page
 * (Milestone 4 Phase 6) so it can also render for the assigned carrier.
 * Privacy is enforced entirely SERVER-SIDE — the API redacts a third
 * party's `actorName`/`actorUserId` before a carrier ever sees this array
 * (see `toEventView` in loads.serializer.ts); this component never needs to
 * know the viewer's role and never hides anything on its own.
 */
export function ShipmentTimeline({ events }: { events: LoadEventView[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted">No history yet.</p>;
  }

  return (
    <ol className="space-y-3">
      {events.map((e) => (
        <li key={e.id} className="flex gap-3 text-sm">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-400" aria-hidden />
          <div>
            <p className="text-ink">
              {LOAD_EVENT_LABELS[e.type] ?? titleCase(e.type)}
              {e.fromStatus && e.toStatus && (
                <span className="text-muted">
                  {" "}
                  · {titleCase(e.fromStatus)} → {titleCase(e.toStatus)}
                </span>
              )}
            </p>
            {e.note && <p className="text-muted">“{e.note}”</p>}
            <p className="text-xs text-muted">
              {fmtDateTime(e.createdAt)}
              {e.actorName && ` · ${e.actorName}`}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
