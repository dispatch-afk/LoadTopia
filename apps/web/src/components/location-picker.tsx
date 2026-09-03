"use client";

import { useState } from "react";
import type { LocationView } from "@loadtopia/shared";
import { ApiError, apiClient } from "@/lib/api-client";
import { Alert, Button, Field, Input, Select, Spinner } from "./ui";

export function LocationPicker({
  label,
  value,
  onChange,
  locations,
  onCreated,
  error,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  locations: LocationView[];
  onCreated: (loc: LocationView) => void;
  error?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    name: "",
    addressLine1: "",
    city: "",
    state: "",
    postalCode: "",
  });
  const set = (k: string, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  async function create() {
    setBusy(true);
    setAddErr(null);
    try {
      const loc = await apiClient<LocationView>("/locations", {
        method: "POST",
        body: JSON.stringify({ ...draft, country: "US" }),
      });
      onCreated(loc);
      onChange(loc.id);
      setAdding(false);
      setDraft({ name: "", addressLine1: "", city: "", state: "", postalCode: "" });
    } catch (err) {
      setAddErr(err instanceof ApiError ? err.message : "Could not save location");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Field label={label} error={error} required>
        <Select value={value} onChange={(e) => onChange(e.target.value)} required>
          <option value="">Select a location…</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name ? `${l.name} — ` : ""}
              {l.city}, {l.state} {l.postalCode}
            </option>
          ))}
        </Select>
      </Field>
      <button
        type="button"
        onClick={() => setAdding((a) => !a)}
        className="lt-focus mt-1 text-xs font-medium text-brand-600 hover:underline"
      >
        {adding ? "Cancel" : "+ New location"}
      </button>

      {adding && (
        <div className="mt-2 space-y-2 rounded-lg border border-line bg-canvas p-3">
          {addErr && <Alert>{addErr}</Alert>}
          <Input placeholder="Name (optional)" value={draft.name} onChange={(e) => set("name", e.target.value)} />
          <Input
            placeholder="Address line 1"
            value={draft.addressLine1}
            onChange={(e) => set("addressLine1", e.target.value)}
          />
          <div className="grid grid-cols-3 gap-2">
            <Input placeholder="City" value={draft.city} onChange={(e) => set("city", e.target.value)} />
            <Input placeholder="ST" maxLength={2} value={draft.state} onChange={(e) => set("state", e.target.value)} />
            <Input
              placeholder="ZIP"
              value={draft.postalCode}
              onChange={(e) => set("postalCode", e.target.value)}
            />
          </div>
          <Button type="button" variant="secondary" onClick={create} disabled={busy}>
            {busy && <Spinner />} Save location
          </Button>
        </div>
      )}
    </div>
  );
}
