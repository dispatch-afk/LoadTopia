import type { CarrierFollowView, CarrierPreferenceType, ConnectionView } from "@loadtopia/shared";
import { apiServer } from "@/lib/api-server";
import { requireMe, activeMembership } from "@/lib/session";
import { NetworkWorkspace } from "@/components/network/network-workspace";

export const dynamic = "force-dynamic";

export default async function NetworkPage() {
  const me = await requireMe();
  const membership = activeMembership(me);
  const isCarrier = membership?.companyType === "CARRIER";

  const [connections, follows, preferencesRes] = await Promise.all([
    apiServer<{ data: ConnectionView[] }>("/api/connections"),
    isCarrier
      ? apiServer<{ data: CarrierFollowView[] }>("/api/follows")
      : Promise.resolve({ data: [] as CarrierFollowView[] }),
    !isCarrier
      ? apiServer<{ data: { carrierCompanyId: string; preference: CarrierPreferenceType }[] }>("/api/preferences")
      : Promise.resolve({ data: [] as { carrierCompanyId: string; preference: CarrierPreferenceType }[] }),
  ]);

  const preferences = new Map(preferencesRes.data.map((p) => [p.carrierCompanyId, p.preference]));

  return (
    <NetworkWorkspace
      companyType={membership?.companyType ?? null}
      connections={connections.data}
      follows={follows.data}
      preferences={preferences}
    />
  );
}
