import type { LoadView } from "@loadtopia/shared";
import { cn } from "@/lib/format";
import { fmtDateTime } from "@/lib/format";
import { shipmentProgress, type StepState } from "@/lib/operations";

const DOT: Record<StepState, string> = {
  done: "border-brand-600 bg-brand-600 text-white",
  current: "border-brand-600 bg-white text-brand-700",
  upcoming: "border-line bg-white text-muted",
};

const LABEL: Record<StepState, string> = {
  done: "text-ink",
  current: "text-ink font-semibold",
  upcoming: "text-muted",
};

/**
 * Visual shipment-progress stepper. Derived entirely from load status + the
 * real operational timestamps (see `shipmentProgress`). Stage state is conveyed
 * by an icon/label pair and a text status, not by colour alone.
 */
export function ShipmentProgress({ load }: { load: LoadView }) {
  const progress = shipmentProgress(load);

  return (
    <section aria-label="Shipment progress">
      {progress.cancelled && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          This shipment was cancelled{progress.cancelledAt ? ` ${fmtDateTime(progress.cancelledAt)}` : ""}.
        </p>
      )}
      <ol className="flex flex-col gap-0 sm:flex-row sm:items-start sm:gap-0">
        {progress.steps.map((step, i) => (
          <li
            key={step.key}
            className="relative flex flex-1 items-start gap-3 pb-5 last:pb-0 sm:flex-col sm:items-center sm:pb-0 sm:text-center"
          >
            {/* connector */}
            {i > 0 && (
              <span
                aria-hidden
                className="absolute left-[11px] top-[-8px] h-[calc(100%-16px)] w-px bg-line sm:left-auto sm:right-[calc(50%+14px)] sm:top-[11px] sm:h-px sm:w-[calc(100%-28px)]"
              />
            )}
            <span
              aria-hidden
              className={cn(
                "z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs font-semibold",
                DOT[step.state],
              )}
            >
              {step.state === "done" ? "✓" : i + 1}
            </span>
            <div className="min-w-0 sm:mt-2">
              <p className={cn("text-sm leading-tight", LABEL[step.state])}>{step.label}</p>
              <p className="text-xs text-muted">
                {step.state === "current" && !progress.cancelled
                  ? "In progress"
                  : step.at
                    ? fmtDateTime(step.at)
                    : step.state === "done"
                      ? "Done"
                      : "—"}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
