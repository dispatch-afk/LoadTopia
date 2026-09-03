"use client";

import { useState } from "react";
import { EQUIPMENT_TYPES, type EquipmentView, type Paginated } from "@loadtopia/shared";
import { ApiError, apiClient, fieldErrors } from "@/lib/api-client";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Select, Spinner } from "./ui";
import { titleCase } from "@/lib/format";

const empty = { type: "DRY_VAN", name: "", trailerLengthFt: "", capacityLbs: "", description: "" };

export function EquipmentManager({ initial }: { initial: Paginated<EquipmentView> }) {
  const [items, setItems] = useState(initial.data);
  const [editing, setEditing] = useState<EquipmentView | null>(null);
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
  function openEdit(e: EquipmentView) {
    setForm({
      type: e.type,
      name: e.name ?? "",
      trailerLengthFt: e.trailerLengthFt ? String(e.trailerLengthFt) : "",
      capacityLbs: e.capacityLbs ? String(e.capacityLbs) : "",
      description: e.description ?? "",
    });
    setEditing(e);
    setCreating(false);
    setError(null);
    setFErr({});
  }
  const close = () => {
    setCreating(false);
    setEditing(null);
  };

  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    setFErr({});
    const payload: Record<string, unknown> = { type: form.type };
    payload.name = form.name || (editing ? null : undefined);
    payload.description = form.description || (editing ? null : undefined);
    payload.trailerLengthFt = form.trailerLengthFt
      ? Number(form.trailerLengthFt)
      : editing
        ? null
        : undefined;
    payload.capacityLbs = form.capacityLbs ? Number(form.capacityLbs) : editing ? null : undefined;
    const body = JSON.stringify(
      Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined)),
    );
    try {
      if (editing) {
        const updated = await apiClient<EquipmentView>(`/equipment/${editing.id}`, {
          method: "PATCH",
          body,
        });
        setItems((xs) => xs.map((x) => (x.id === updated.id ? updated : x)));
      } else {
        const created = await apiClient<EquipmentView>("/equipment", { method: "POST", body });
        setItems((xs) => [created, ...xs]);
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

  async function deactivate(e: EquipmentView) {
    if (!window.confirm(`Deactivate "${e.name ?? titleCase(e.type)}"?`)) return;
    try {
      const updated = await apiClient<EquipmentView>(`/equipment/${e.id}`, { method: "DELETE" });
      setItems((xs) => xs.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not deactivate");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>+ New equipment</Button>
      </div>

      {(creating || editing) && (
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold">{editing ? "Edit equipment" : "New equipment"}</h2>
          <form onSubmit={save} className="space-y-3">
            {error && <Alert>{error}</Alert>}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Type" required>
                <Select value={form.type} onChange={(e) => set("type", e.target.value)}>
                  {EQUIPMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {titleCase(t)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Unit name / number" error={fErr.name}>
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
              </Field>
              <Field label="Trailer length (ft)" error={fErr.trailerLengthFt}>
                <Input
                  type="number"
                  value={form.trailerLengthFt}
                  onChange={(e) => set("trailerLengthFt", e.target.value)}
                />
              </Field>
              <Field label="Capacity (lb)" error={fErr.capacityLbs}>
                <Input
                  type="number"
                  value={form.capacityLbs}
                  onChange={(e) => set("capacityLbs", e.target.value)}
                />
              </Field>
            </div>
            <Field label="Notes" error={fErr.description}>
              <Input value={form.description} onChange={(e) => set("description", e.target.value)} />
            </Field>
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

      {items.length === 0 ? (
        <EmptyState title="No equipment yet" description="Track the trailers and trucks your company runs." />
      ) : (
        <Card className="divide-y divide-line">
          {items.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <p className="font-medium text-ink">
                  {e.name ?? titleCase(e.type)}{" "}
                  {!e.isActive && <Badge tone="gray">Inactive</Badge>}
                </p>
                <p className="text-sm text-muted">
                  {titleCase(e.type)}
                  {e.trailerLengthFt ? ` · ${e.trailerLengthFt} ft` : ""}
                  {e.capacityLbs ? ` · ${e.capacityLbs.toLocaleString()} lb` : ""}
                </p>
              </div>
              {e.isActive && (
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" onClick={() => openEdit(e)}>
                    Edit
                  </Button>
                  <Button variant="ghost" onClick={() => deactivate(e)}>
                    Deactivate
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
