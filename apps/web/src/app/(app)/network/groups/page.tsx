import { redirect } from "next/navigation";
import type { CarrierGroupView } from "@loadtopia/shared";
import { apiServer } from "@/lib/api-server";
import { requireMe, activeMembership } from "@/lib/session";
import { CarrierGroupsList } from "@/components/network/carrier-groups-list";

export const dynamic = "force-dynamic";

export default async function CarrierGroupsPage() {
  const me = await requireMe();
  const membership = activeMembership(me);
  // Carrier Groups are a shipper-only concept — a carrier has no route in.
  if (membership?.companyType !== "SHIPPER") redirect("/network");

  const { data } = await apiServer<{ data: CarrierGroupView[] }>("/api/carrier-groups");
  return <CarrierGroupsList initial={data} />;
}
