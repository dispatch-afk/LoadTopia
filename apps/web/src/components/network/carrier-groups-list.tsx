"use client";

import Link from "next/link";
import { useState } from "react";
import type { CarrierGroupView } from "@loadtopia/shared";
import { ApiError, apiClient } from "@/lib/api-client";
import { ConfirmDialog } from "@/components/dialog";
import { Alert, Button, Card, EmptyState, Field, Input, PageHeader, Spinner } from "@/components/ui";
import { fmtDate } from "@/lib/format";

/** SHIPPER-only, private internal organization tool — no social/community
 *  language, no decorative configuration (name only). */
export function CarrierGroupsList({ initial }: { initial: CarrierGroupView[] }) {
  const [groups, setGroups] = useState(initial);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CarrierGroupView | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await apiClient<CarrierGroupView>("/carrier-groups", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      setGroups((gs) => [...gs, created].sort((a, b) => a.name.localeCompare(b.name)));
      setCreating(false);
      setName("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the group");
    } finally {
      setBusy(false);
    }
  }

  async function remove(group: CarrierGroupView) {
    setBusy(true);
    setError(null);
    try {
      await apiClient(`/carrier-groups/${group.id}`, { method: "DELETE" });
      setGroups((gs) => gs.filter((g) => g.id !== group.id));
      setDeleting(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete the group");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Carrier Groups"
        subtitle="Private collections of your connected carriers — visible only to your team."
        action={
          !creating && (
            <Button onClick={() => setCreating(true)}>+ New group</Button>
          )
        }
      />
      {error && <Alert>{error}</Alert>}

      {creating && (
        <Card className="mb-4 p-5">
          <form onSubmit={create} className="flex flex-wrap items-end gap-3">
            <Field label="Group name" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                minLength={2}
                maxLength={100}
                required
                autoFocus
                placeholder="e.g. Texas Dry Van"
              />
            </Field>
            <Button type="submit" disabled={busy || name.trim().length < 2}>
              {busy && <Spinner />} Create
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setCreating(false);
                setName("");
              }}
            >
              Cancel
            </Button>
          </form>
        </Card>
      )}

      {groups.length === 0 ? (
        <EmptyState title="No Carrier Groups yet. Create a group to organize connected carriers." />
      ) : (
        <Card className="divide-y divide-line">
          {groups.map((g) => (
            <div key={g.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <Link href={`/network/groups/${g.id}`} className="font-medium text-brand-600 hover:underline">
                  {g.name}
                </Link>
                <p className="text-xs text-muted">
                  {g.memberCount} carrier{g.memberCount === 1 ? "" : "s"} · updated {fmtDate(g.updatedAt)}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Link href={`/network/groups/${g.id}`}>
                  <Button variant="ghost">Manage</Button>
                </Link>
                <Button variant="ghost" onClick={() => setDeleting(g)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting ? `Delete "${deleting.name}"?` : "Delete this group?"}
        description="Removing this group does not disconnect or block any carrier — it only removes this internal organization tool."
        confirmLabel="Delete"
        tone="danger"
        busy={busy}
        onConfirm={() => deleting && remove(deleting)}
      />
    </div>
  );
}
