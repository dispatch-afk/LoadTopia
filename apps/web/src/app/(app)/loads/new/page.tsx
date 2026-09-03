import type { LocationView, Paginated } from "@loadtopia/shared";
import { apiServer } from "@/lib/api-server";
import { PageHeader } from "@/components/ui";
import { LoadForm } from "@/components/load-form";

export default async function NewLoadPage() {
  const locations = await apiServer<Paginated<LocationView>>("/api/locations", {
    query: { pageSize: 100 },
  });
  return (
    <div>
      <PageHeader title="New load" subtitle="Create a draft load for your company." />
      <LoadForm mode="create" initialLocations={locations.data} />
    </div>
  );
}
