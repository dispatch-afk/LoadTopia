"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, apiClient, fieldErrors } from "@/lib/api-client";
import { Alert, Button, Field, Input, Spinner, Textarea } from "@/components/ui";

/**
 * Records a MANUAL operational check-in for the assigned carrier
 * (`POST /api/loads/:id/check-ins`). `recordedAt` is server-authoritative and
 * is deliberately never sent. City / State / Note lead; reported coordinates
 * are optional and tucked away.
 */
export function CheckInForm({ loadId }: { loadId: string }) {
  const router = useRouter();
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [note, setNote] = useState("");
  const [showCoords, setShowCoords] = useState(false);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fErrors, setFErrors] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFErrors({});

    const hasLat = latitude.trim() !== "";
    const hasLon = longitude.trim() !== "";
    if (hasLat !== hasLon) {
      setFErrors({ latitude: "Enter both latitude and longitude, or neither." });
      setBusy(false);
      return;
    }

    // Only user-entered observation fields. No client timestamp.
    const payload: Record<string, unknown> = { city, state };
    if (note.trim() !== "") payload.note = note.trim();
    if (hasLat && hasLon) {
      payload.latitude = Number(latitude);
      payload.longitude = Number(longitude);
    }

    try {
      await apiClient(`/loads/${loadId}/check-ins`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setCity("");
      setState("");
      setNote("");
      setLatitude("");
      setLongitude("");
      setShowCoords(false);
      router.refresh();
    } catch (err) {
      setFErrors(fieldErrors(err));
      setError(err instanceof ApiError ? err.message : "Could not record the check-in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
        <Field label="City" required error={fErrors.city}>
          <Input value={city} onChange={(e) => setCity(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="State" required hint="2-letter code" error={fErrors.state}>
          <Input
            value={state}
            onChange={(e) => setState(e.target.value.toUpperCase())}
            maxLength={2}
            autoComplete="off"
          />
        </Field>
      </div>
      <Field label="Note (optional)" error={fErrors.note}>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          placeholder="e.g. Fueling near Effingham, ETA on track"
        />
      </Field>

      {showCoords ? (
        <fieldset className="rounded-lg border border-line p-3">
          <legend className="px-1 text-xs font-medium text-muted">
            Reported coordinates (optional, manually entered — not a GPS fix)
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Latitude" error={fErrors.latitude}>
              <Input
                inputMode="decimal"
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                placeholder="41.8781"
              />
            </Field>
            <Field label="Longitude" error={fErrors.longitude}>
              <Input
                inputMode="decimal"
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                placeholder="-87.6298"
              />
            </Field>
          </div>
        </fieldset>
      ) : (
        <button
          type="button"
          onClick={() => setShowCoords(true)}
          className="lt-focus text-xs font-medium text-brand-600 hover:underline"
        >
          + Add reported coordinates
        </button>
      )}

      <Button type="submit" disabled={busy || !city.trim() || state.trim().length !== 2}>
        {busy && <Spinner />} Record check-in
      </Button>
    </form>
  );
}
