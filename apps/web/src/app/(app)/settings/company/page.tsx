import { notFound } from "next/navigation";
import type { CompanyView } from "@loadtopia/shared";
import { ApiError, apiServer } from "@/lib/api-server";
import { requireMe, can } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { CompanyForm } from "@/components/company-form";

export default async function CompanySettingsPage() {
  const me = await requireMe();
  if (!me.activeCompanyId) notFound();

  let company: CompanyView;
  try {
    company = await apiServer<CompanyView>(`/api/companies/${me.activeCompanyId}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  return (
    <div>
      <PageHeader title="Company" subtitle={`${company.type.toLowerCase()} · ${company.name}`} />
      <CompanyForm company={company} canEdit={can(me, "company:update:own")} />
    </div>
  );
}
