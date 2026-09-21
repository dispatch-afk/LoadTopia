"use client";

import { useEffect, useState } from "react";
import type { FacilityScopeView, FreightAccessSummary, LocationView, Paginated } from "@loadtopia/shared";
import { ApiError, apiClient } from "@/lib/api-client";
import { Alert, Button, Spinner } from "./ui";
import { Dialog } from "./dialog";

type AccessMode = "COMPANY_WIDE" | "ASSIGNED";

/**
 * Milestone 4 Phase 11 — the facility-scope admin editor. Data is fetched
 * lazily, only while the dialog is open (never on page load): the current
 * membership's scope (`GET /memberships/:id/facility-scope`) and the
 * company's active locations (`GET /locations`), both existing endpoints —
 * no new API surface. Saving is a full-replace `PUT`, matching the
 * server's own semantics; an "Assigned facilities" selection may never be
 * saved empty (that would silently and ambiguously become company-wide) —
 * switch to "Company-wide" explicitly instead.
 */
export function FacilityScopeEditor({
  open,
  onOpenChange,
  membershipId,
  memberName,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  membershipId: string;
  memberName: string;
  onSaved: (freightAccess: FreightAccessSummary) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locations, setLocations] = useState<LocationView[]>([]);
  const [mode, setMode] = useState<AccessMode>("COMPANY_WIDE");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      apiClient<FacilityScopeView>(`/memberships/${membershipId}/facility-scope`),
      apiClient<Paginated<LocationView>>(`/locations?pageSize=200`),
    ])
      .then(([scope, locs]) => {
        if (cancelled) return;
        setLocations(locs.data);
        setMode(scope.companyWide ? "COMPANY_WIDE" : "ASSIGNED");
        setSelected(new Set(scope.locationIds));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not load freight access");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, membershipId]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const locationIds = mode === "COMPANY_WIDE" ? [] : Array.from(selected);
      const result = await apiClient<FacilityScopeView>(`/memberships/${membershipId}/facility-scope`, {
        method: "PUT",
        body: JSON.stringify({ locationIds }),
      });
      onSaved({ companyWide: result.companyWide, facilityCount: result.locationIds.length });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save freight access");
    } finally {
      setSaving(false);
    }
  }

  const saveDisabled = saving || loading || (mode === "ASSIGNED" && selected.size === 0);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Freight access"
      description={`Which of ${memberName}'s own-company freight this member can see.`}
      className="max-w-lg"
    >
      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-4">
          {error && <Alert>{error}</Alert>}

          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium text-ink">Access to freight</legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="freight-access-mode"
                className="lt-focus mt-0.5"
                checked={mode === "COMPANY_WIDE"}
                onChange={() => setMode("COMPANY_WIDE")}
              />
              <span>
                <span className="block font-medium text-ink">Company-wide</span>
                <span className="block text-xs text-muted">
                  Sees every load, shipment, and offer thread for this company.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="freight-access-mode"
                className="lt-focus mt-0.5"
                checked={mode === "ASSIGNED"}
                onChange={() => setMode("ASSIGNED")}
              />
              <span>
                <span className="block font-medium text-ink">Assigned facilities</span>
                <span className="block text-xs text-muted">
                  Sees only freight whose origin or destination is one of the facilities below.
                </span>
              </span>
            </label>
          </fieldset>

          {mode === "ASSIGNED" && (
            <div
              role="group"
              aria-label="Assigned facilities"
              className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-line p-2"
            >
              {locations.length === 0 ? (
                <p className="px-1 py-2 text-sm text-muted">No active locations yet.</p>
              ) : (
                locations.map((loc) => (
                  <label
                    key={loc.id}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-canvas"
                  >
                    <input
                      type="checkbox"
                      className="lt-focus"
                      checked={selected.has(loc.id)}
                      onChange={() => toggle(loc.id)}
                    />
                    <span>
                      {loc.name ? `${loc.name} — ` : ""}
                      {loc.city}, {loc.state}
                    </span>
                  </label>
                ))
              )}
              {locations.length > 0 && selected.size === 0 && (
                <p className="px-1 pt-1 text-xs text-red-600">Select at least one facility, or choose Company-wide.</p>
              )}
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={saveDisabled}>
              {saving && <Spinner />} Save
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
