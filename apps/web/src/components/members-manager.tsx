"use client";

import { useState } from "react";
import { UserRole, type CompanyMemberView, type FreightAccessSummary } from "@loadtopia/shared";
import { ApiError, apiClient } from "@/lib/api-client";
import { FacilityScopeEditor } from "./facility-scope-editor";
import { Alert, Badge, Button, Card, Field, Input, Select, Spinner } from "./ui";

function freightAccessLabel(a: FreightAccessSummary): string {
  if (a.companyWide) return "Company-wide";
  return `${a.facilityCount} assigned facilit${a.facilityCount === 1 ? "y" : "ies"}`;
}

export function MembersManager({
  companyId,
  initial,
  currentUserId,
  canManage,
  canManageFacilityScope,
}: {
  companyId: string;
  initial: CompanyMemberView[];
  currentUserId: string;
  canManage: boolean;
  /** Milestone 4 Phase 11: facility-scope editing requires company-primary
   *  authority, a STRICTER gate than `canManage` (every active member holds
   *  `membership:manage`, but only the primary/owner — or platform admin —
   *  may change facility scope; the backend re-enforces this regardless). */
  canManageFacilityScope: boolean;
}) {
  const [members, setMembers] = useState(initial);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>(UserRole.SHIPPER);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingScopeFor, setEditingScopeFor] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const member = await apiClient<CompanyMemberView>(`/companies/${companyId}/members`, {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
      setMembers((m) => [...m.filter((x) => x.membershipId !== member.membershipId), member]);
      setEmail("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add member");
    } finally {
      setBusy(false);
    }
  }

  async function patch(membershipId: string, body: Record<string, unknown>) {
    setError(null);
    try {
      const updated = await apiClient<CompanyMemberView>(`/memberships/${membershipId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setMembers((m) => m.map((x) => (x.membershipId === updated.membershipId ? updated : x)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update member");
    }
  }

  function applyFreightAccess(membershipId: string, freightAccess: FreightAccessSummary) {
    setMembers((m) => (m.map((x) => (x.membershipId === membershipId ? { ...x, freightAccess } : x))));
  }

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}

      {canManage && (
        <Card className="p-5">
          <h2 className="mb-1 text-sm font-semibold">Add a member</h2>
          <p className="mb-3 text-xs text-muted">
            The person must already have a LoadTopia account.
          </p>
          <form onSubmit={add} className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1">
              <Field label="Email">
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Role">
              <Select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value={UserRole.SHIPPER}>Shipper</option>
                <option value={UserRole.CARRIER}>Carrier</option>
              </Select>
            </Field>
            <Button type="submit" disabled={busy}>
              {busy && <Spinner />} Add
            </Button>
          </form>
        </Card>
      )}

      <Card className="divide-y divide-line">
        {members.map((m) => (
          <div key={m.membershipId} className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
            <div>
              <p className="font-medium text-ink">
                {m.firstName} {m.lastName}{" "}
                {m.isPrimary && <Badge tone="indigo">Owner</Badge>}
                {!m.isActive && <Badge tone="gray">Inactive</Badge>}
              </p>
              <p className="text-sm text-muted">{m.email}</p>
              {m.isActive && (
                <p className="mt-1 text-xs text-muted">
                  Freight access: <Badge tone={m.freightAccess.companyWide ? "gray" : "indigo"}>
                    {freightAccessLabel(m.freightAccess)}
                  </Badge>
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {canManageFacilityScope && m.userId !== currentUserId && m.isActive && (
                <Button variant="secondary" onClick={() => setEditingScopeFor(m.membershipId)}>
                  Manage access
                </Button>
              )}
              {canManage && m.userId !== currentUserId && m.isActive ? (
                <>
                  <Select
                    value={m.role}
                    onChange={(e) => patch(m.membershipId, { role: e.target.value })}
                    className="w-32"
                  >
                    <option value={UserRole.SHIPPER}>Shipper</option>
                    <option value={UserRole.CARRIER}>Carrier</option>
                  </Select>
                  <Button
                    variant="ghost"
                    onClick={() => patch(m.membershipId, { isActive: false })}
                  >
                    Deactivate
                  </Button>
                </>
              ) : canManage && !m.isActive ? (
                <Button variant="ghost" onClick={() => patch(m.membershipId, { isActive: true })}>
                  Reactivate
                </Button>
              ) : (
                <Badge>{m.role}</Badge>
              )}
            </div>
          </div>
        ))}
      </Card>

      {members
        .filter((m) => m.membershipId === editingScopeFor)
        .map((m) => (
          <FacilityScopeEditor
            key={m.membershipId}
            open={editingScopeFor === m.membershipId}
            onOpenChange={(open) => setEditingScopeFor(open ? m.membershipId : null)}
            membershipId={m.membershipId}
            memberName={`${m.firstName} ${m.lastName}`}
            onSaved={(freightAccess) => applyFreightAccess(m.membershipId, freightAccess)}
          />
        ))}
    </div>
  );
}
