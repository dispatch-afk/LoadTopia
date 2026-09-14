"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AudiencePreviewView,
  CarrierGroupView,
  ConnectionView,
  LoadAudienceStrategyType,
  LoadView,
  PostLoadAudienceInput,
} from "@loadtopia/shared";
import { ApiError, apiClient } from "@/lib/api-client";
import { Alert, Button, Card, Spinner } from "@/components/ui";
import { ConfirmDialog } from "@/components/dialog";
import {
  AUDIENCE_STAGE_LABEL,
  AUDIENCE_STRATEGY_LABEL,
  computeTimingWarningMinutes,
  presetReleaseAt,
  RELEASE_PRESET_HOURS,
  timingWarningText,
} from "@/lib/audience";
import { fmtExactDateTime, fmtMoney, fmtWindow, titleCase } from "@/lib/format";

type Strategy = LoadAudienceStrategyType;

interface ScheduledHop {
  toStage: "NETWORK" | "MARKETPLACE";
  releaseAt: Date;
}

const STRATEGIES: { value: Strategy; description: string }[] = [
  {
    value: "MARKETPLACE",
    description: "Visible immediately to every currently eligible marketplace carrier.",
  },
  {
    value: "NETWORK_FIRST",
    description: "Visible first only to your ACCEPTED connected carriers.",
  },
  {
    value: "SELECTED_FIRST",
    description: "Visible first only to the specific connected carriers you choose.",
  },
];

function ReleaseTimingPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Date | null;
  onChange: (d: Date | null) => void;
}) {
  const [mode, setMode] = useState<"none" | "preset" | "custom">(value ? "preset" : "none");
  // Which PRESET is selected, tracked explicitly rather than re-comparing
  // Date objects — `presetReleaseAt(h)` computes from `new Date()` at call
  // time, so re-deriving "which hour is active" from `value` alone would
  // almost never match to the millisecond on a later render.
  const [selectedHours, setSelectedHours] = useState<number | null>(null);

  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-ink">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          aria-pressed={mode === "none"}
          onClick={() => {
            setMode("none");
            setSelectedHours(null);
            onChange(null);
          }}
          className={`rounded-full border px-3 py-1 text-xs font-medium ${mode === "none" ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-white text-slate-600 hover:bg-canvas"}`}
        >
          Don&apos;t release automatically
        </button>
        {RELEASE_PRESET_HOURS.map((h) => (
          <button
            key={h}
            type="button"
            aria-pressed={mode === "preset" && selectedHours === h}
            onClick={() => {
              setMode("preset");
              setSelectedHours(h);
              onChange(presetReleaseAt(h));
            }}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              mode === "preset" && selectedHours === h
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-line bg-white text-slate-600 hover:bg-canvas"
            }`}
          >
            {h}h
          </button>
        ))}
        <button
          type="button"
          aria-pressed={mode === "custom"}
          onClick={() => {
            setMode("custom");
            setSelectedHours(null);
          }}
          className={`rounded-full border px-3 py-1 text-xs font-medium ${mode === "custom" ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-white text-slate-600 hover:bg-canvas"}`}
        >
          Custom
        </button>
      </div>
      {mode === "custom" && (
        <input
          type="datetime-local"
          className="mt-2 rounded-lg border border-line px-3 py-1.5 text-sm"
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value) : null)}
        />
      )}
      {value && (
        <p className="mt-1.5 text-sm text-ink">
          Release scheduled for <span className="font-medium">{fmtExactDateTime(value.toISOString())}</span>
        </p>
      )}
    </div>
  );
}

export function ReviewPostForm({
  load,
  connections,
  groups,
}: {
  load: LoadView;
  connections: ConnectionView[];
  groups: CarrierGroupView[];
}) {
  const router = useRouter();
  const [strategy, setStrategy] = useState<Strategy>("MARKETPLACE");
  const [carrierIds, setCarrierIds] = useState<Set<string>>(new Set());
  const [groupIds, setGroupIds] = useState<Set<string>>(new Set());
  const [firstHopTarget, setFirstHopTarget] = useState<"NETWORK" | "MARKETPLACE">("NETWORK");
  const [firstHopAt, setFirstHopAt] = useState<Date | null>(null);
  const [secondHopAt, setSecondHopAt] = useState<Date | null>(null);
  const [preview, setPreview] = useState<AudiencePreviewView | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const releases: ScheduledHop[] = useMemo(() => {
    if (strategy === "MARKETPLACE") return [];
    if (strategy === "NETWORK_FIRST") {
      return firstHopAt ? [{ toStage: "MARKETPLACE", releaseAt: firstHopAt }] : [];
    }
    // SELECTED_FIRST
    if (!firstHopAt) return [];
    if (firstHopTarget === "MARKETPLACE") {
      return [{ toStage: "MARKETPLACE", releaseAt: firstHopAt }];
    }
    const hops: ScheduledHop[] = [{ toStage: "NETWORK", releaseAt: firstHopAt }];
    if (secondHopAt) hops.push({ toStage: "MARKETPLACE", releaseAt: secondHopAt });
    return hops;
  }, [strategy, firstHopAt, firstHopTarget, secondHopAt]);

  function buildInput(): PostLoadAudienceInput {
    if (strategy === "MARKETPLACE") return { strategy: "MARKETPLACE" };
    if (strategy === "NETWORK_FIRST") {
      return {
        strategy: "NETWORK_FIRST",
        releases: releases.map((r) => ({ toStage: r.toStage, releaseAt: r.releaseAt.toISOString() })),
      };
    }
    return {
      strategy: "SELECTED_FIRST",
      carrierCompanyIds: [...carrierIds],
      carrierGroupIds: [...groupIds],
      releases: releases.map((r) => ({ toStage: r.toStage, releaseAt: r.releaseAt.toISOString() })),
    };
  }

  useEffect(() => {
    let cancelled = false;
    setPreviewing(true);
    apiClient<AudiencePreviewView>(`/loads/${load.id}/audience-preview`, {
      method: "POST",
      body: JSON.stringify(buildInput()),
    })
      .then((v) => {
        if (!cancelled) setPreview(v);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      })
      .finally(() => {
        if (!cancelled) setPreviewing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [strategy, carrierIds, groupIds, firstHopAt, firstHopTarget, secondHopAt, load.id]);

  const selectedCount = carrierIds.size + groupIds.size;
  const canPost =
    strategy === "MARKETPLACE"
      ? true
      : strategy === "SELECTED_FIRST" && selectedCount === 0
        ? false
        : preview?.eligibleCarrierCount !== 0;

  const timingWarnings = releases
    .map((r) => ({
      toStage: r.toStage,
      minutes: computeTimingWarningMinutes(r.releaseAt, load.pickupWindowStart),
    }))
    .filter((w): w is { toStage: "NETWORK" | "MARKETPLACE"; minutes: number } => w.minutes !== null);

  async function submit() {
    setPosting(true);
    setError(null);
    try {
      await apiClient(`/loads/${load.id}/post`, { method: "POST", body: JSON.stringify(buildInput()) });
      router.push(`/loads/${load.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not post this load");
      setPosting(false);
      setConfirming(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Freight</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs uppercase text-muted">Lane</dt>
              <dd>
                {load.origin.city}, {load.origin.state} → {load.destination.city}, {load.destination.state}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-muted">Equipment</dt>
              <dd>{titleCase(load.equipmentType)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-muted">Pickup</dt>
              <dd>{fmtWindow(load.pickupWindowStart, load.pickupWindowEnd)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-muted">Delivery</dt>
              <dd>{fmtWindow(load.deliveryWindowStart, load.deliveryWindowEnd)}</dd>
            </div>
          </dl>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Commercial</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs uppercase text-muted">Mode</dt>
              <dd>
                {load.commercialMode === "PUBLISH_RATE" ? "Publish a Rate" : "Request Carrier Offers"}
              </dd>
            </div>
            {load.commercialMode === "PUBLISH_RATE" && (
              <>
                <div>
                  <dt className="text-xs uppercase text-muted">Posted rate</dt>
                  <dd className="font-medium">{fmtMoney(load.postedRate)}</dd>
                </div>
                {load.ratePerMile && (
                  <div>
                    <dt className="text-xs uppercase text-muted">Rate per mile</dt>
                    <dd>${load.ratePerMile}/mi</dd>
                  </div>
                )}
              </>
            )}
          </dl>
          <p className="mt-2 text-xs text-muted">
            {load.commercialMode === "PUBLISH_RATE"
              ? "Carriers will see this exact rate and may Book at Posted Rate or Make an Offer."
              : "Carriers will see no price and may Submit Offer."}
          </p>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Audience</h2>
          <div className="space-y-2">
            {STRATEGIES.map((s) => (
              <button
                key={s.value}
                type="button"
                aria-pressed={strategy === s.value}
                onClick={() => setStrategy(s.value)}
                className={`block w-full rounded-lg border p-3 text-left transition ${
                  strategy === s.value
                    ? "border-brand-600 bg-brand-50"
                    : "border-line bg-white hover:bg-canvas"
                }`}
              >
                <p className="text-sm font-medium text-ink">{AUDIENCE_STRATEGY_LABEL[s.value]}</p>
                <p className="text-xs text-muted">{s.description}</p>
              </button>
            ))}
          </div>

          {strategy === "SELECTED_FIRST" && (
            <div className="mt-4 space-y-3 border-t border-line pt-4">
              <div>
                <p className="mb-1.5 text-sm font-medium text-ink">Carrier Groups</p>
                {groups.length === 0 ? (
                  <p className="text-sm text-muted">No Carrier Groups yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {groups.map((g) => {
                      const active = groupIds.has(g.id);
                      return (
                        <button
                          key={g.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() =>
                            setGroupIds((prev) => {
                              const next = new Set(prev);
                              if (active) next.delete(g.id);
                              else next.add(g.id);
                              return next;
                            })
                          }
                          className={`rounded-full border px-3 py-1 text-xs font-medium ${active ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-white text-slate-600 hover:bg-canvas"}`}
                        >
                          {active ? "✓ " : ""}
                          {g.name} ({g.memberCount})
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div>
                <p className="mb-1.5 text-sm font-medium text-ink">Individual connected carriers</p>
                {connections.length === 0 ? (
                  <p className="text-sm text-muted">No connected carriers yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {connections.map((c) => {
                      const active = carrierIds.has(c.counterpartCompanyId);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() =>
                            setCarrierIds((prev) => {
                              const next = new Set(prev);
                              if (active) next.delete(c.counterpartCompanyId);
                              else next.add(c.counterpartCompanyId);
                              return next;
                            })
                          }
                          className={`rounded-full border px-3 py-1 text-xs font-medium ${active ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-white text-slate-600 hover:bg-canvas"}`}
                        >
                          {active ? "✓ " : ""}
                          {c.counterpartCompanyName}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>

        {strategy !== "MARKETPLACE" && (
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">Release strategy</h2>
            <div className="space-y-4">
              {strategy === "SELECTED_FIRST" && (
                <div>
                  <p className="mb-1.5 text-sm font-medium text-ink">Next stage</p>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      aria-pressed={firstHopTarget === "NETWORK"}
                      onClick={() => {
                        setFirstHopTarget("NETWORK");
                        setSecondHopAt(null);
                      }}
                      className={`rounded-full border px-3 py-1 text-xs font-medium ${firstHopTarget === "NETWORK" ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-white text-slate-600 hover:bg-canvas"}`}
                    >
                      Broaden to my Carrier Network
                    </button>
                    <button
                      type="button"
                      aria-pressed={firstHopTarget === "MARKETPLACE"}
                      onClick={() => {
                        setFirstHopTarget("MARKETPLACE");
                        setSecondHopAt(null);
                      }}
                      className={`rounded-full border px-3 py-1 text-xs font-medium ${firstHopTarget === "MARKETPLACE" ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-white text-slate-600 hover:bg-canvas"}`}
                    >
                      Release directly to Marketplace
                    </button>
                  </div>
                </div>
              )}

              <ReleaseTimingPicker
                label={
                  strategy === "NETWORK_FIRST"
                    ? "Release to Marketplace"
                    : firstHopTarget === "NETWORK"
                      ? "Release to Carrier Network"
                      : "Release to Marketplace"
                }
                value={firstHopAt}
                onChange={setFirstHopAt}
              />

              {strategy === "SELECTED_FIRST" && firstHopTarget === "NETWORK" && firstHopAt && (
                <ReleaseTimingPicker
                  label="Then release to Marketplace"
                  value={secondHopAt}
                  onChange={setSecondHopAt}
                />
              )}

              {timingWarnings.map((w) => (
                <Alert key={w.toStage} tone="info">
                  {timingWarningText(w.minutes)}
                </Alert>
              ))}
            </div>
          </Card>
        )}
      </div>

      <div className="space-y-6">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Summary</h2>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-xs uppercase text-muted">Strategy</dt>
              <dd>{AUDIENCE_STRATEGY_LABEL[strategy]}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-muted">Initial audience</dt>
              <dd>
                {previewing ? (
                  <Spinner />
                ) : strategy === "MARKETPLACE" ? (
                  "All currently eligible marketplace carriers"
                ) : preview?.eligibleCarrierCount != null ? (
                  `${preview.eligibleCarrierCount} eligible carrier${preview.eligibleCarrierCount === 1 ? "" : "s"}`
                ) : (
                  "—"
                )}
              </dd>
              {preview && preview.ineligibleSelectedCount > 0 && (
                <p className="mt-1 text-xs text-amber-700">
                  {preview.ineligibleSelectedCount} selected carrier
                  {preview.ineligibleSelectedCount === 1 ? " is" : "s are"} not currently eligible
                  (not connected, or blocked) and won&apos;t be included.
                </p>
              )}
              {strategy !== "MARKETPLACE" && !previewing && preview?.eligibleCarrierCount === 0 && (
                <p className="mt-1 text-xs text-red-700">
                  No eligible carriers yet — choose Marketplace, or connect/select carriers first.
                </p>
              )}
            </div>
            {releases.map((r) => (
              <div key={r.toStage}>
                <dt className="text-xs uppercase text-muted">
                  Release to {AUDIENCE_STAGE_LABEL[r.toStage]}
                </dt>
                <dd>{fmtExactDateTime(r.releaseAt.toISOString())}</dd>
              </div>
            ))}
            {strategy !== "MARKETPLACE" && releases.length === 0 && (
              <div>
                <dt className="text-xs uppercase text-muted">Automatic release</dt>
                <dd>Don&apos;t release automatically</dd>
              </div>
            )}
          </dl>

          {error && (
            <div className="mt-3">
              <Alert>{error}</Alert>
            </div>
          )}

          <div className="mt-4">
            <Button
              className="w-full justify-center"
              disabled={!canPost || previewing}
              onClick={() => setConfirming(true)}
            >
              Post load
            </Button>
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Post this load?"
        description={`This makes the load visible to ${strategy === "MARKETPLACE" ? "the marketplace" : AUDIENCE_STAGE_LABEL[strategy === "NETWORK_FIRST" ? "NETWORK" : "SELECTED"]}. You can manage further release from the load's detail page afterward.`}
        confirmLabel="Post load"
        busy={posting}
        onConfirm={submit}
      />
    </div>
  );
}
