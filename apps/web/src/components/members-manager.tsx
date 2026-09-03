"use client";

import { useState } from "react";
import { UserRole, type CompanyMemberView } from "@loadtopia/shared";
import { ApiError, apiClient } from "@/lib/api-client";
import { Alert, Badge, Button, Card, Field, Input, Select, Spinner } from "./ui";

export function MembersManager({
  companyId,
  initial,
  currentUserId,
  canManage,
}: {
  companyId: string;
  initial: CompanyMemberView[];
  currentUserId: string;
  canManage: boolean;
}) {
  const [members, setMembers] = useState(initial);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>(UserRole.SHIPPER);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
          <div key={m.membershipId} className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <p className="font-medium text-ink">
                {m.firstName} {m.lastName}{" "}
                {m.isPrimary && <Badge tone="indigo">Owner</Badge>}
                {!m.isActive && <Badge tone="gray">Inactive</Badge>}
              </p>
              <p className="text-sm text-muted">{m.email}</p>
            </div>
            <div className="flex items-center gap-2">
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
    </div>
  );
}
