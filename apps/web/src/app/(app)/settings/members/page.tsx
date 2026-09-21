import { notFound } from "next/navigation";
import type { CompanyMemberView } from "@loadtopia/shared";
import { apiServer } from "@/lib/api-server";
import { requireMe, can, isActivePrimary } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { MembersManager } from "@/components/members-manager";

export default async function MembersPage() {
  const me = await requireMe();
  if (!me.activeCompanyId) notFound();

  const { data } = await apiServer<{ data: CompanyMemberView[] }>(
    `/api/companies/${me.activeCompanyId}/members`,
  );

  return (
    <div>
      <PageHeader title="Team" subtitle="People who can act for this company." />
      <MembersManager
        companyId={me.activeCompanyId}
        initial={data}
        currentUserId={me.user.id}
        // Milestone 4 release correction: adding a member, changing a
        // member's role, and activating/deactivating a membership now
        // require company-primary/platform-admin authority server-side
        // (see CompaniesService#addMember/#updateMembership) — `membership:
        // manage` alone is held by every active member, so it is no longer
        // sufficient on its own to show these controls.
        canManage={can(me, "membership:manage") && isActivePrimary(me)}
        canManageFacilityScope={isActivePrimary(me)}
      />
    </div>
  );
}
