import type { LoadCheckIn } from "@loadtopia/db";
import type { CheckInView } from "@loadtopia/shared";

/** Serialize an append-only `load_check_ins` row for authorized shipment
 *  participants. Reported coordinates cross the wire as decimal strings, like
 *  every other coordinate in the API. */
export function toCheckInView(c: LoadCheckIn): CheckInView {
  return {
    id: c.id,
    loadId: c.loadId,
    actorUserId: c.actorUserId,
    city: c.city,
    state: c.state,
    note: c.note,
    latitude: c.latitude?.toString() ?? null,
    longitude: c.longitude?.toString() ?? null,
    recordedAt: c.recordedAt.toISOString(),
    createdAt: c.createdAt.toISOString(),
  };
}
