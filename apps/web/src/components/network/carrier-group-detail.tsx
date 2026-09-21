"use client";

import Link from "next/link";
import { useState } from "react";
import type { CarrierGroupDetailView, EligibleGroupCarrierView } from "@loadtopia/shared";
import { ApiError, apiClient } from "@/lib/api-client";
import { ConfirmDialog } from "@/components/dialog";
import { Alert, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export function CarrierGroupDetail({
  initial,
  initialEligible,
}: {
  initial: CarrierGroupDetailView;
  initialEligible: EligibleGroupCarrierView[];
}) {
  const [group, setGroup] = useState(initial);
  const [eligible, setEligible] = useState(initialEligible);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(initial.name);
  const [adding, setAdding] = useState(false);
  const [selectedCarrierId, setSelectedCarrierId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingGroup, setDeletingGroup] = useState(false);
  const [removingCarrierId, setRemovingCarrierId] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const updated = await apiClient<{ name: string; updatedAt: string }>(`/carrier-groups/${group.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim() }),
      });
      setGroup((g) => ({ ...g, name: updated.name, updatedAt: updated.updatedAt }));
      setRenaming(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not rename the group");
    } finally {
      setBusy(false);
    }
  }

  async function removeGroup() {
    setBusy(true);
    setError(null);
    try {
      await apiClient(`/carrier-groups/${group.id}`, { method: "DELETE" });
      setDeleted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete the group");
      setBusy(false);
    }
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCarrierId) return;
    setBusy(true);
    setError(null);
    try {
      const member = await apiClient<{ carrierCompanyId: string; carrierCompanyName: string; addedAt: string }>(
        `/carrier-groups/${group.id}/members`,
        { method: "POST", body: JSON.stringify({ carrierCompanyId: selectedCarrierId }) },
      );
      setGroup((g) => ({ ...g, memberCount: g.memberCount + 1, members: [...g.members, member] }));
      setEligible((es) => es.filter((c) => c.companyId !== selectedCarrierId));
      setAdding(false);
      setSelectedCarrierId("");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.message} — this carrier's connection or block status may have changed. Reload the page to see current eligibility.`
          : "Could not add this carrier",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(carrierCompanyId: string, carrierCompanyName: string) {
    setBusy(true);
    setError(null);
    try {
      await apiClient(`/carrier-groups/${group.id}/members/${carrierCompanyId}`, { method: "DELETE" });
      setGroup((g) => ({
        ...g,
        memberCount: g.memberCount - 1,
        members: g.members.filter((m) => m.carrierCompanyId !== carrierCompanyId),
      }));
      setEligible((es) => [...es, { companyId: carrierCompanyId, companyName: carrierCompanyName }]);
      setRemovingCarrierId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove this carrier");
    } finally {
      setBusy(false);
    }
  }

  if (deleted) {
    return (
      <EmptyState
        title="Group deleted"
        description="Connected carriers that were in it were not disconnected or blocked."
        action={
          <Link href="/network/groups" className="text-sm font-medium text-brand-600 hover:underline">
            Back to Carrier Groups
          </Link>
        }
      />
    );
  }

  const removing = group.members.find((m) => m.carrierCompanyId === removingCarrierId) ?? null;

  return (
    <div>
      <PageHeader
        title={group.name}
        subtitle={`${group.memberCount} carrier${group.memberCount === 1 ? "" : "s"} · updated ${fmtDate(group.updatedAt)}`}
        action={
          <Link href="/network/groups">
            <Button variant="secondary">All groups</Button>
          </Link>
        }
      />
      {error && <Alert>{error}</Alert>}

      <Card className="mb-6 p-5">
        {renaming ? (
          <form onSubmit={rename} className="flex flex-wrap items-end gap-3">
            <Field label="Group name" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={100} required autoFocus />
            </Field>
            <Button type="submit" disabled={busy || name.trim().length < 2}>
              {busy && <Spinner />} Save
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setRenaming(false);
                setName(group.name);
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => setRenaming(true)}>
              Rename group
            </Button>
            <Button variant="danger" onClick={() => setDeletingGroup(true)}>
              Delete group
            </Button>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">Members</h2>
          {!adding && (
            <Button onClick={() => setAdding(true)} disabled={eligible.length === 0}>
              + Add carrier
            </Button>
          )}
        </div>

        {eligible.length === 0 && !adding && group.members.length === 0 && (
          <p className="mb-4 text-xs text-muted">
            Only carriers with an accepted connection are eligible.{" "}
            <Link href="/network" className="text-brand-600 hover:underline">
              Connect with a carrier
            </Link>{" "}
            first.
          </p>
        )}

        {adding && (
          <form onSubmit={addMember} className="mb-4 flex flex-wrap items-end gap-3">
            <Field label="Carrier" required>
              <Select
                value={selectedCarrierId}
                onChange={(e) => setSelectedCarrierId(e.target.value)}
                required
                autoFocus
              >
                <option value="">Select a connected carrier…</option>
                {eligible.map((c) => (
                  <option key={c.companyId} value={c.companyId}>
                    {c.companyName}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" disabled={busy || !selectedCarrierId}>
              {busy && <Spinner />} Add
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setAdding(false);
                setSelectedCarrierId("");
              }}
            >
              Cancel
            </Button>
          </form>
        )}

        {group.members.length === 0 ? (
          <EmptyState title="No carriers in this group yet." />
        ) : (
          <ul className="divide-y divide-line">
            {group.members.map((m) => (
              <li key={m.carrierCompanyId} className="flex items-center justify-between gap-3 py-3">
                <Link
                  href={`/network/companies/${m.carrierCompanyId}`}
                  className="font-medium text-brand-600 hover:underline"
                >
                  {m.carrierCompanyName}
                </Link>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted">Added {fmtDate(m.addedAt)}</span>
                  <Button variant="ghost" onClick={() => setRemovingCarrierId(m.carrierCompanyId)}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        open={deletingGroup}
        onOpenChange={setDeletingGroup}
        title={`Delete "${group.name}"?`}
        description="This removes the group. Connected carriers already in it are not disconnected or blocked, and their relationship history is unaffected."
        confirmLabel="Delete"
        tone="danger"
        busy={busy}
        onConfirm={removeGroup}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemovingCarrierId(null)}
        title="Remove this carrier from the group?"
        description="This does not disconnect, block, or notify the carrier, and does not change your historical relationship."
        confirmLabel="Remove"
        busy={busy}
        onConfirm={() => removing && removeMember(removing.carrierCompanyId, removing.carrierCompanyName)}
      />
    </div>
  );
}
