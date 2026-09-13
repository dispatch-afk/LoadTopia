import type { LoadStatus } from "@loadtopia/shared";
import { Badge } from "./ui";
import { titleCase } from "@/lib/format";
import { LOAD_STATUS_TONE } from "@/lib/status-tone";

export function LoadStatusBadge({ status }: { status: LoadStatus }) {
  return <Badge tone={LOAD_STATUS_TONE[status]}>{titleCase(status)}</Badge>;
}
