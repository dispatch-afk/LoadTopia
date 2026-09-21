"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CarrierGroupView } from "@loadtopia/shared";
import { ApiError, apiClient } from "@/lib/api-client";
import { Alert, Button, Spinner } from "@/components/ui";

/**
 * SHIPPER-ONLY, company-primary/admin only: which of the shipper's own
 * Carrier Groups this carrier belongs to. A toggle group of buttons, each
 * announcing its member/non-member state via `aria-pressed` AND a checkmark
 * (never color alone).
 */
export function GroupMembershipControl({
  carrierCompanyId,
  canManage,
  allGroups,
  initialMemberGroupIds,
}: {
  carrierCompanyId: string;
  canManage: boolean;
  allGroups: CarrierGroupView[];
  initialMemberGroupIds: string[];
}) {
  const router = useRouter();
  const [memberIds, setMemberIds] = useState(new Set(initialMemberGroupIds));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(groupId: string) {
    setBusyId(groupId);
    setError(null);
    try {
      if (memberIds.has(groupId)) {
        await apiClient(`/carrier-groups/${groupId}/members/${carrierCompanyId}`, { method: "DELETE" });
        setMemberIds((prev) => {
          const next = new Set(prev);
          next.delete(groupId);
          return next;
        });
      } else {
        await apiClient(`/carrier-groups/${groupId}/members`, {
          method: "POST",
          body: JSON.stringify({ carrierCompanyId }),
        });
        setMemberIds((prev) => new Set(prev).add(groupId));
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update group membership");
    } finally {
      setBusyId(null);
    }
  }

  if (!canManage) return null;

  if (allGroups.length === 0) {
    return (
      <p className="text-sm text-muted">
        No Carrier Groups yet.{" "}
        <Link href="/network/groups" className="text-brand-600 hover:underline">
          Create one
        </Link>{" "}
        to organize connected carriers.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        {allGroups.map((g) => {
          const isMember = memberIds.has(g.id);
          return (
            <Button
              key={g.id}
              type="button"
              variant={isMember ? "primary" : "secondary"}
              aria-pressed={isMember}
              onClick={() => toggle(g.id)}
              disabled={busyId !== null}
            >
              {busyId === g.id && <Spinner />} {isMember ? "✓ " : ""}
              {g.name}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
