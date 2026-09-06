import { Prisma, type PrismaClient } from "@loadtopia/db";
import {
  assertCanOperateShipment,
  assertCanReadLoad,
  assertPermission,
  buildCheckInAddedEvent,
  isWithinOperationalActivityWindow,
  Permission,
} from "@loadtopia/domain";
import type { AuthenticatedActor, CheckInView, CreateCheckInInput } from "@loadtopia/shared";
import { conflict, notFound } from "../../lib/errors";
import { appendLoadEvent } from "../../lib/load-lifecycle";
import { toCheckInView } from "./check-ins.serializer";

/**
 * Manual operational check-ins (Milestone 3, tracking Level B).
 *
 * First-party observations only — no GeocodingProvider, no RoutingProvider, no
 * TrackingProvider, no coordinate derivation. A check-in row plus its immutable
 * `CHECK_IN_ADDED` event commit atomically or not at all. Rows are append-only:
 * there is no update or delete path.
 *
 * Write authority = the Slice-4 shipment-operation boundary
 * ({@link assertCanOperateShipment} + `SHIPMENT_OPERATE_ASSIGNED`): only the
 * carrier company assigned to THIS load. Read authority = the load's own
 * `canReadLoad` (owning shipper, assigned/winning carrier, admin).
 */
export class CheckInsService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Chronological check-in history for one load. */
  async list(actor: AuthenticatedActor, loadId: string): Promise<CheckInView[]> {
    const load = await this.prisma.load.findUnique({
      where: { id: loadId },
      select: { shipperCompanyId: true, carrierCompanyId: true },
    });
    if (!load) throw notFound("Load not found");
    assertCanReadLoad(actor, load); // 404 for anyone outside the load's scope

    const rows = await this.prisma.loadCheckIn.findMany({
      where: { loadId },
      orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
    });
    return rows.map(toCheckInView);
  }

  /**
   * Record one manual check-in. Server-authoritative end to end: the row's
   * `recordedAt` and the event both use a single `now` captured inside the
   * transaction, after the load is row-locked and re-validated.
   */
  async create(
    actor: AuthenticatedActor,
    loadId: string,
    input: CreateCheckInInput,
  ): Promise<CheckInView> {
    assertPermission(actor, Permission.SHIPMENT_OPERATE_ASSIGNED);

    const load = await this.prisma.load.findUnique({
      where: { id: loadId },
      select: { shipperCompanyId: true, carrierCompanyId: true, status: true },
    });
    if (!load) throw notFound("Load not found");
    // 404 for anyone who cannot read the load; 403 for a reader who is not the
    // assigned carrier company (e.g. the owning shipper).
    assertCanOperateShipment(actor, load);

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM loads WHERE id = ${loadId}::uuid FOR UPDATE`;
      const fresh = await tx.load.findUniqueOrThrow({
        where: { id: loadId },
        select: { status: true, carrierCompanyId: true },
      });
      // Re-authorize against the load AS IT ACTUALLY IS under the lock — a
      // check-in racing a lifecycle change authorizes against fresh state.
      assertCanOperateShipment(actor, {
        shipperCompanyId: load.shipperCompanyId,
        carrierCompanyId: fresh.carrierCompanyId,
        status: fresh.status,
      });
      if (!isWithinOperationalActivityWindow(fresh.status)) {
        throw conflict(
          "Check-ins can only be recorded while the shipment is active (assigned through delivered).",
        );
      }

      const now = new Date();
      const row = await tx.loadCheckIn.create({
        data: {
          loadId,
          actorUserId: actor.userId,
          city: input.city,
          state: input.state,
          note: input.note ?? null,
          latitude: input.latitude == null ? null : new Prisma.Decimal(input.latitude),
          longitude: input.longitude == null ? null : new Prisma.Decimal(input.longitude),
          recordedAt: now,
        },
      });
      await appendLoadEvent(
        tx,
        buildCheckInAddedEvent({
          loadId,
          actorUserId: actor.userId,
          actorCompanyId: actor.companyId,
          checkInId: row.id,
          city: row.city,
          state: row.state,
        }),
      );
      return row;
    });

    return toCheckInView(created);
  }
}
