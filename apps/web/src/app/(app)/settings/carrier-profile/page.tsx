import { notFound } from "next/navigation";
import type { CarrierProfileView } from "@loadtopia/shared";
import { ApiError, apiServer } from "@/lib/api-server";
import { PageHeader } from "@/components/ui";
import { CarrierProfileManager } from "@/components/carrier-profile-manager";

export const dynamic = "force-dynamic";

export default async function CarrierProfilePage() {
  let profile: CarrierProfileView | null;
  try {
    ({ profile } = await apiServer<{ profile: CarrierProfileView | null }>("/api/carrier/profile"));
  } catch (err) {
    // Non-carrier companies have no such resource.
    if (err instanceof ApiError && (err.status === 400 || err.status === 403)) notFound();
    throw err;
  }

  return (
    <div>
      <PageHeader
        title="Carrier Profile"
        subtitle="Your marketplace identity, capabilities, and verification status."
      />
      <CarrierProfileManager profile={profile} />
    </div>
  );
}
