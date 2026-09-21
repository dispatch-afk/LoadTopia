import { notFound } from "next/navigation";
import type { CarrierGroupView, CompanyProfileView } from "@loadtopia/shared";
import { ApiError, apiServer } from "@/lib/api-server";
import { requireMe, activeMembership, isActivePrimary } from "@/lib/session";
import { CompanyProfile } from "@/components/network/company-profile";

export const dynamic = "force-dynamic";

export default async function CompanyProfilePage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const me = await requireMe();
  const membership = activeMembership(me);

  let profile: CompanyProfileView;
  try {
    profile = await apiServer<CompanyProfileView>(`/api/companies/${companyId}/profile`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  }

  const showGroups = membership?.companyType === "SHIPPER" && profile.type === "CARRIER";
  const allGroups = showGroups
    ? (await apiServer<{ data: CarrierGroupView[] }>("/api/carrier-groups")).data
    : [];

  return (
    <CompanyProfile
      myCompanyId={membership?.companyId ?? null}
      myCompanyType={membership?.companyType ?? null}
      canManage={isActivePrimary(me)}
      profile={profile}
      allGroups={allGroups}
    />
  );
}
