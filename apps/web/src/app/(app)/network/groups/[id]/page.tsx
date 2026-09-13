import { notFound, redirect } from "next/navigation";
import type { CarrierGroupDetailView, EligibleGroupCarrierView } from "@loadtopia/shared";
import { ApiError, apiServer } from "@/lib/api-server";
import { requireMe, activeMembership } from "@/lib/session";
import { CarrierGroupDetail } from "@/components/network/carrier-group-detail";

export const dynamic = "force-dynamic";

export default async function CarrierGroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await requireMe();
  const membership = activeMembership(me);
  if (membership?.companyType !== "SHIPPER") redirect("/network");

  let group: CarrierGroupDetailView;
  try {
    group = await apiServer<CarrierGroupDetailView>(`/api/carrier-groups/${id}`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  }
  const { data: eligible } = await apiServer<{ data: EligibleGroupCarrierView[] }>(
    `/api/carrier-groups/${id}/eligible-carriers`,
  );

  return <CarrierGroupDetail initial={group} initialEligible={eligible} />;
}
