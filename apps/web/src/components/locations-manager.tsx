"use client";

import { useState } from "react";
import type { LocationView, Paginated } from "@loadtopia/shared";
import { ApiError, apiClient, fieldErrors } from "@/lib/api-client";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Spinner } from "./ui";
import { fmtDate } from "@/lib/format";

const empty = { name: "", addressLine1: "", addressLine2: "", city: "", state: "", postalCode: "" };

export function LocationsManager({ initial }: { initial: Paginated<LocationView> }) {
  const [locations, setLocations] = useState(initial.data);
  const [editing, setEditing] = useState<LocationView | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(empty);
  const [fErr, setFErr] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  function openCreate() {
    setForm(empty);
    setEditing(null);
    setCreating(true);
    setError(null);
    setFErr({});
  }
  function openEdit(l: LocationView) {
    setForm({
      name: l.name ?? "",
      addressLine1: l.addressLine1,
      addressLine2: l.addressLine2 ?? "",
      city: l.city,
      state: l.state,
      postalCode: l.postalCode,
    });
    setEditing(l);
    setCreating(false);
    setError(null);
    setFErr({});
  }
  function close() {
    setCreating(false);
    setEditing(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFErr({});
    const body = JSON.stringify({
      ...form,
      addressLine2: form.addressLine2 || (editing ? null : undefined),
      name: form.name || (editing ? null : undefined),
      country: "US",
    });
    try {
      if (editing) {
        const updated = await apiClient<LocationView>(`/locations/${editing.id}`, {
          method: "PATCH",
          body,
        });
        setLocations((ls) => ls.map((l) => (l.id === updated.id ? updated : l)));
      } else {
        const created = await apiClient<LocationView>("/locations", { method: "POST", body });
        setLocations((ls) => [created, ...ls]);
      }
      close();
    } catch (err) {
      if (err instanceof ApiError && err.code === "VALIDATION_ERROR") {
        setFErr(fieldErrors(err));
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : "Could not save");
      }
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(l: LocationView) {
    if (!window.confirm(`Remove "${l.name ?? l.city}" from the location book?`)) return;
    try {
      const updated = await apiClient<LocationView>(`/locations/${l.id}`, { method: "DELETE" });
      setLocations((ls) => ls.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove location");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>+ New location</Button>
      </div>

      {(creating || editing) && (
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold">{editing ? "Edit location" : "New location"}</h2>
          <form onSubmit={save} className="space-y-3">
            {error && <Alert>{error}</Alert>}
            <Field label="Name" hint="Optional label, e.g. “Main Warehouse”." error={fErr.name}>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="Address line 1" error={fErr.addressLine1} required>
              <Input
                required
                value={form.addressLine1}
                onChange={(e) => set("addressLine1", e.target.value)}
              />
            </Field>
            <Field label="Address line 2" error={fErr.addressLine2}>
              <Input value={form.addressLine2} onChange={(e) => set("addressLine2", e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="col-span-2">
                <Field label="City" error={fErr.city} required>
                  <Input required value={form.city} onChange={(e) => set("city", e.target.value)} />
                </Field>
              </div>
              <Field label="State" error={fErr.state} required>
                <Input
                  required
                  maxLength={2}
                  value={form.state}
                  onChange={(e) => set("state", e.target.value)}
                />
              </Field>
              <Field label="ZIP" error={fErr.postalCode} required>
                <Input
                  required
                  value={form.postalCode}
                  onChange={(e) => set("postalCode", e.target.value)}
                />
              </Field>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {busy && <Spinner />} {editing ? "Save" : "Create"}
              </Button>
              <Button type="button" variant="secondary" onClick={close}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {locations.length === 0 ? (
        <EmptyState
          title="No locations yet"
          description="Add pickup and delivery addresses once, then reuse them on every load."
        />
      ) : (
        <Card className="divide-y divide-line">
          {locations.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium text-ink">
                  {l.name ?? `${l.city}, ${l.state}`}{" "}
                  {!l.isActive && <Badge tone="gray">Archived</Badge>}
                </p>
                <p className="truncate text-sm text-muted">
                  {l.addressLine1}, {l.city}, {l.state} {l.postalCode}
                  {l.isGeocoded ? "" : " · not geocoded"}
                </p>
                <p className="text-xs text-muted">Added {fmtDate(l.createdAt)}</p>
              </div>
              {l.isActive && (
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" onClick={() => openEdit(l)}>
                    Edit
                  </Button>
                  <Button variant="ghost" onClick={() => deactivate(l)}>
                    Remove
                  </Button>
                </div>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
