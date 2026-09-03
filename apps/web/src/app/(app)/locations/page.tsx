import type { LocationView, Paginated } from "@loadtopia/shared";
import { apiServer } from "@/lib/api-server";
import { PageHeader } from "@/components/ui";
import { LocationsManager } from "@/components/locations-manager";

export default async function LocationsPage() {
  const initial = await apiServer<Paginated<LocationView>>("/api/locations", {
    query: { pageSize: 100, includeInactive: "true" },
  });
  return (
    <div>
      <PageHeader
        title="Location book"
        subtitle="Reusable pickup and delivery addresses for your company."
      />
      <LocationsManager initial={initial} />
    </div>
  );
}
