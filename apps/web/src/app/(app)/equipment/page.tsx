import type { EquipmentView, Paginated } from "@loadtopia/shared";
import { apiServer } from "@/lib/api-server";
import { PageHeader } from "@/components/ui";
import { EquipmentManager } from "@/components/equipment-manager";

export default async function EquipmentPage() {
  const initial = await apiServer<Paginated<EquipmentView>>("/api/equipment", {
    query: { pageSize: 100, includeInactive: "true" },
  });
  return (
    <div>
      <PageHeader title="Equipment" subtitle="Trailers and trucks your company manages." />
      <EquipmentManager initial={initial} />
    </div>
  );
}
