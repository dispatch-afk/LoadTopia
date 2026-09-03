"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  EQUIPMENT_TYPES,
  TRANSPORT_MODES,
  type LoadView,
  type LocationView,
} from "@loadtopia/shared";
import { ApiError, apiClient, fieldErrors } from "@/lib/api-client";
import { Alert, Button, Card, Field, Input, Select, Spinner } from "./ui";
import { LocationPicker } from "./location-picker";
import { fromLocalInputValue, titleCase, toLocalInputValue } from "@/lib/format";

interface Props {
  mode: "create" | "edit";
  load?: LoadView;
  initialLocations: LocationView[];
}

export function LoadForm({ mode, load, initialLocations }: Props) {
  const router = useRouter();
  const [locations, setLocations] = useState(initialLocations);
  const [error, setError] = useState<string | null>(null);
  const [fErr, setFErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    originLocationId: load?.origin.id ?? "",
    destinationLocationId: load?.destination.id ?? "",
    equipmentType: load?.equipmentType ?? "DRY_VAN",
    mode: load?.mode ?? "FTL",
    commodity: load?.commodity ?? "",
    weightLbs: load?.weightLbs ? String(load.weightLbs) : "",
    pickupWindowStart: toLocalInputValue(load?.pickupWindowStart ?? null),
    pickupWindowEnd: toLocalInputValue(load?.pickupWindowEnd ?? null),
    deliveryWindowStart: toLocalInputValue(load?.deliveryWindowStart ?? null),
    deliveryWindowEnd: toLocalInputValue(load?.deliveryWindowEnd ?? null),
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  function buildPayload() {
    const p: Record<string, unknown> = {
      originLocationId: form.originLocationId,
      destinationLocationId: form.destinationLocationId,
      equipmentType: form.equipmentType,
      mode: form.mode,
    };
    p.commodity = form.commodity.trim() || (mode === "edit" ? null : undefined);
    p.weightLbs = form.weightLbs ? Number(form.weightLbs) : mode === "edit" ? null : undefined;
    for (const key of [
      "pickupWindowStart",
      "pickupWindowEnd",
      "deliveryWindowStart",
      "deliveryWindowEnd",
    ] as const) {
      const iso = fromLocalInputValue(form[key]);
      p[key] = iso ?? (mode === "edit" ? null : undefined);
    }
    // Drop undefined keys on create so optional fields stay optional.
    return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFErr({});
    setBusy(true);
    try {
      const payload = buildPayload();
      const result =
        mode === "create"
          ? await apiClient<LoadView>("/loads", { method: "POST", body: JSON.stringify(payload) })
          : await apiClient<LoadView>(`/loads/${load!.id}`, {
              method: "PATCH",
              body: JSON.stringify(payload),
            });
      router.push(`/loads/${result.id}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "VALIDATION_ERROR") {
        setFErr(fieldErrors(err));
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : "Something went wrong");
      }
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {error && <Alert>{error}</Alert>}

      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink">Route</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <LocationPicker
            label="Origin"
            value={form.originLocationId}
            onChange={(id) => set("originLocationId", id)}
            locations={locations}
            onCreated={(l) => setLocations((ls) => [...ls, l])}
            error={fErr.originLocationId}
          />
          <LocationPicker
            label="Destination"
            value={form.destinationLocationId}
            onChange={(id) => set("destinationLocationId", id)}
            locations={locations}
            onCreated={(l) => setLocations((ls) => [...ls, l])}
            error={fErr.destinationLocationId}
          />
        </div>
        <p className="mt-3 text-xs text-muted">
          Miles and estimated drive time are calculated on the server from these locations.
        </p>
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink">Freight</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Equipment" required>
            <Select value={form.equipmentType} onChange={(e) => set("equipmentType", e.target.value)}>
              {EQUIPMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {titleCase(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Mode">
            <Select value={form.mode} onChange={(e) => set("mode", e.target.value)}>
              {TRANSPORT_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Commodity" error={fErr.commodity}>
            <Input value={form.commodity} onChange={(e) => set("commodity", e.target.value)} />
          </Field>
          <Field label="Weight (lb)" error={fErr.weightLbs}>
            <Input
              type="number"
              min={1}
              value={form.weightLbs}
              onChange={(e) => set("weightLbs", e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-1 text-sm font-semibold text-ink">Schedule</h2>
        <p className="mb-4 text-xs text-muted">
          Optional while a load is a draft; required before you post it.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Pickup — earliest" error={fErr.pickupWindowStart}>
            <Input
              type="datetime-local"
              value={form.pickupWindowStart}
              onChange={(e) => set("pickupWindowStart", e.target.value)}
            />
          </Field>
          <Field label="Pickup — latest" error={fErr.pickupWindowEnd}>
            <Input
              type="datetime-local"
              value={form.pickupWindowEnd}
              onChange={(e) => set("pickupWindowEnd", e.target.value)}
            />
          </Field>
          <Field label="Delivery — earliest" error={fErr.deliveryWindowStart}>
            <Input
              type="datetime-local"
              value={form.deliveryWindowStart}
              onChange={(e) => set("deliveryWindowStart", e.target.value)}
            />
          </Field>
          <Field label="Delivery — latest" error={fErr.deliveryWindowEnd}>
            <Input
              type="datetime-local"
              value={form.deliveryWindowEnd}
              onChange={(e) => set("deliveryWindowEnd", e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy && <Spinner />} {mode === "create" ? "Create load" : "Save changes"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
