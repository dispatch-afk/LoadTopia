import { notFound } from "next/navigation";
import type { CompanyMemberView } from "@loadtopia/shared";
import { apiServer } from "@/lib/api-server";
import { requireMe, can } from "@/lib/session";
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
        canManage={can(me, "membership:manage")}
      />
    </div>
  );
}
