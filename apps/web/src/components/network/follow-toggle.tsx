"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, apiClient } from "@/lib/api-client";
import { Button, Spinner } from "@/components/ui";

/**
 * Carrier-only, private, lightweight: "keep this shipper easy for me to
 * find." No approval, no shipper notification, no confirmation dialog for
 * either direction — an inline label change is confirmation enough.
 */
export function FollowToggle({
  shipperCompanyId,
  initiallyFollowing,
}: {
  shipperCompanyId: string;
  initiallyFollowing: boolean;
}) {
  const router = useRouter();
  const [following, setFollowing] = useState(initiallyFollowing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      if (following) {
        await apiClient(`/companies/${shipperCompanyId}/follow`, { method: "DELETE" });
        setFollowing(false);
      } else {
        await apiClient(`/companies/${shipperCompanyId}/follow`, { method: "POST" });
        setFollowing(true);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update follow status");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button variant={following ? "secondary" : "primary"} onClick={toggle} disabled={busy}>
        {busy && <Spinner />} {following ? "Following" : "Follow"}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
