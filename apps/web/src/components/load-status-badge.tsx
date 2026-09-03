import type { LoadStatus } from "@loadtopia/shared";
import { Badge } from "./ui";
import { titleCase } from "@/lib/format";

const TONE: Record<string, "gray" | "green" | "amber" | "red" | "indigo"> = {
  DRAFT: "gray",
  POSTED: "indigo",
  OFFER_RECEIVED: "amber",
  AWARDED: "green",
  CARRIER_ASSIGNED: "green",
  CANCELLED: "red",
  COMPLETED: "green",
};

export function LoadStatusBadge({ status }: { status: LoadStatus }) {
  return <Badge tone={TONE[status] ?? "amber"}>{titleCase(status)}</Badge>;
}
