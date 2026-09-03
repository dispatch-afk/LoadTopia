import type { Prisma, PrismaClient } from "@loadtopia/db";
import {
  assertCanModifyLoad,
  assertCanReadLoad,
  assertLoadTransition,
  assertPermission,
  assertPostReadiness,
  assertLoadWindows,
  buildLoadCreatedEvent,
  buildLoadUpdatedEvent,
  buildStatusChangeEvent,
  canCancelLoad,
  formatLoadNumber,
  Permission,
  type LoadEventDraft,
} from "@loadtopia/domain";
import type { ProviderRegistry } from "@loadtopia/providers";
import {
  type AuthenticatedActor,
  type CreateLoadInput,
  type ListLoadsQuery,
  LoadStatus,
  type LoadListItem,
  type LoadView,
  type Paginated,
  type UpdateLoadInput,
} from "@loadtopia/shared";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { paginate, toSkipTake } from "../../lib/pagination";
import {
  loadDetailInclude,
  loadListInclude,
  M1_EXPOSED_STATUSES,
  toLoadListItem,
  toLoadView,
} from "./loads.serializer";
import { computeRouting } from "./routing";

const parseDate = (v: string | null | undefined): Date | null => (v == null ? null : new Date(v));

export class LoadsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly providers: ProviderRegistry,
    private readonly log: { warn: (obj: unknown, msg: string) => void },
  ) {}

  private get routingIsMock(): boolean {
    return this.providers.routing.isMock;
  }

  private async loadDetail(id: string): Promise<LoadView> {
    const row = await this.prisma.load.findUniqueOrThrow({
      where: { id },
      include: loadDetailInclude,
    });
    return toLoadView(row, this.routingIsMock);
  }

  // -- create --------------------------------------------------------------
  async create(
    actor: AuthenticatedActor,
    companyId: string,
    input: CreateLoadInput,
  ): Promise<LoadView> {
    assertPermission(actor, Permission.LOAD_CREATE);

    assertLoadWindows({
      pickupWindowStart: input.pickupWindowStart,
      pickupWindowEnd: input.pickupWindowEnd,
      deliveryWindowStart: input.deliveryWindowStart,
      deliveryWindowEnd: input.deliveryWindowEnd,
    });

    const locations = await this.requireOwnedLocations(companyId, [
      input.originLocationId,
      input.destinationLocationId,
    ]);
    const origin = locations.get(input.originLocationId)!;
    const destination = locations.get(input.destinationLocationId)!;

    const routing = await computeRouting(
      this.providers.routing,
      origin,
      destination,
      input.equipmentType,
      this.log,
    );

    const id = await this.prisma.$transaction(async (tx) => {
      // Bump the per-company counter under a row lock; the returned value is
      // unique for this company, and `{prefix}-{seq}` is globally unique.
      const company = await tx.company.update({
        where: { id: companyId },
        data: { loadSequence: { increment: 1 } },
        select: { loadNumberPrefix: true, loadSequence: true },
      });
      const referenceNumber = formatLoadNumber(company.loadNumberPrefix, company.loadSequence);

      const load = await tx.load.create({
        data: {
          referenceNumber,
          status: LoadStatus.DRAFT,
          shipperCompanyId: companyId,
          createdByUserId: actor.userId,
          updatedByUserId: actor.userId,
          originLocationId: input.originLocationId,
          destinationLocationId: input.destinationLocationId,
          equipmentType: input.equipmentType,
          mode: input.mode,
          commodity: input.commodity ?? null,
          weightLbs: input.weightLbs ?? null,
          pickupWindowStart: parseDate(input.pickupWindowStart),
          pickupWindowEnd: parseDate(input.pickupWindowEnd),
          deliveryWindowStart: parseDate(input.deliveryWindowStart),
          deliveryWindowEnd: parseDate(input.deliveryWindowEnd),
          distanceMeters: routing?.distanceMeters ?? null,
          driveTimeMinutes: routing?.driveTimeMinutes ?? null,
          routingProvider: routing?.provider ?? null,
          routedAt: routing?.routedAt ?? null,
        },
      });

      await this.appendEvent(
        tx,
        buildLoadCreatedEvent({
          loadId: load.id,
          actorUserId: actor.userId,
          initialStatus: LoadStatus.DRAFT,
        }),
      );
      return load.id;
    });

    return this.loadDetail(id);
  }

  // -- read ---------------------------------------------------------------
  async list(
    actor: AuthenticatedActor,
    companyId: string,
    q: ListLoadsQuery,
  ): Promise<Paginated<LoadListItem>> {
    assertPermission(actor, Permission.LOAD_READ_OWN);
    const where: Prisma.LoadWhereInput = {
      shipperCompanyId: companyId,
      ...(q.status ? { status: q.status } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.load.findMany({
        where,
        include: loadListInclude,
        orderBy: { createdAt: "desc" },
        ...toSkipTake(q),
      }),
      this.prisma.load.count({ where }),
    ]);
    return paginate(rows.map(toLoadListItem), total, q);
  }

  async getById(actor: AuthenticatedActor, id: string): Promise<LoadView> {
    const load = await this.prisma.load.findUnique({
      where: { id },
      select: { shipperCompanyId: true, carrierCompanyId: true },
    });
    if (!load) throw notFound("Load not found");
    assertCanReadLoad(actor, load);
    return this.loadDetail(id);
  }

  // -- update -----------------------------------------------------------
  async update(actor: AuthenticatedActor, id: string, input: UpdateLoadInput): Promise<LoadView> {
    const load = await this.prisma.load.findUnique({ where: { id } });
    if (!load) throw notFound("Load not found");
    assertCanModifyLoad(actor, load);
    assertPermission(actor, Permission.LOAD_UPDATE_OWN);

    if (load.status !== LoadStatus.DRAFT) {
      throw conflict("Only a DRAFT load can be edited. Withdraw the load to DRAFT first.");
    }

    const merged = {
      originLocationId: input.originLocationId ?? load.originLocationId,
      destinationLocationId: input.destinationLocationId ?? load.destinationLocationId,
      equipmentType: input.equipmentType ?? load.equipmentType,
      pickupWindowStart:
        input.pickupWindowStart === undefined
          ? load.pickupWindowStart
          : parseDate(input.pickupWindowStart),
      pickupWindowEnd:
        input.pickupWindowEnd === undefined
          ? load.pickupWindowEnd
          : parseDate(input.pickupWindowEnd),
      deliveryWindowStart:
        input.deliveryWindowStart === undefined
          ? load.deliveryWindowStart
          : parseDate(input.deliveryWindowStart),
      deliveryWindowEnd:
        input.deliveryWindowEnd === undefined
          ? load.deliveryWindowEnd
          : parseDate(input.deliveryWindowEnd),
    };

    if (merged.originLocationId === merged.destinationLocationId) {
      throw badRequest("origin and destination must be different");
    }
    assertLoadWindows(merged);

    const locChanged =
      input.originLocationId !== undefined || input.destinationLocationId !== undefined;
    const routeInputsChanged = locChanged || input.equipmentType !== undefined;

    let routingData: Prisma.LoadUncheckedUpdateInput = {};
    if (routeInputsChanged) {
      const locs = await this.requireOwnedLocations(load.shipperCompanyId, [
        merged.originLocationId,
        merged.destinationLocationId,
      ]);
      const routing = await computeRouting(
        this.providers.routing,
        locs.get(merged.originLocationId)!,
        locs.get(merged.destinationLocationId)!,
        merged.equipmentType,
        this.log,
      );
      routingData = {
        distanceMeters: routing?.distanceMeters ?? null,
        driveTimeMinutes: routing?.driveTimeMinutes ?? null,
        routingProvider: routing?.provider ?? null,
        routedAt: routing?.routedAt ?? null,
      };
    }

    const changedFields = Object.keys(input);

    await this.prisma.$transaction(async (tx) => {
      await tx.load.update({
        where: { id },
        data: {
          ...(input.originLocationId !== undefined
            ? { originLocationId: input.originLocationId }
            : {}),
          ...(input.destinationLocationId !== undefined
            ? { destinationLocationId: input.destinationLocationId }
            : {}),
          ...(input.equipmentType !== undefined ? { equipmentType: input.equipmentType } : {}),
          ...(input.mode !== undefined ? { mode: input.mode } : {}),
          ...(input.commodity !== undefined ? { commodity: input.commodity } : {}),
          ...(input.weightLbs !== undefined ? { weightLbs: input.weightLbs } : {}),
          ...(input.pickupWindowStart !== undefined
            ? { pickupWindowStart: parseDate(input.pickupWindowStart) }
            : {}),
          ...(input.pickupWindowEnd !== undefined
            ? { pickupWindowEnd: parseDate(input.pickupWindowEnd) }
            : {}),
          ...(input.deliveryWindowStart !== undefined
            ? { deliveryWindowStart: parseDate(input.deliveryWindowStart) }
            : {}),
          ...(input.deliveryWindowEnd !== undefined
            ? { deliveryWindowEnd: parseDate(input.deliveryWindowEnd) }
            : {}),
          ...routingData,
          updatedByUserId: actor.userId,
        },
      });
      await this.appendEvent(
        tx,
        buildLoadUpdatedEvent({ loadId: id, actorUserId: actor.userId, changedFields }),
      );
    });

    return this.loadDetail(id);
  }

  // -- delete (DRAFT only, hard) ------------------------------------------
  async remove(actor: AuthenticatedActor, id: string): Promise<void> {
    const load = await this.prisma.load.findUnique({ where: { id } });
    if (!load) throw notFound("Load not found");
    assertCanModifyLoad(actor, load);
    assertPermission(actor, Permission.LOAD_DELETE_OWN);

    if (load.status !== LoadStatus.DRAFT) {
      throw conflict("Only a DRAFT load can be deleted. Cancel the load instead.");
    }

    await this.prisma.$transaction(async (tx) => {
      // Opt this transaction into the append-only trigger's delete exception so
      // the CREATED event is removed by the FK cascade with the load.
      await tx.$executeRawUnsafe(`SET LOCAL "loadtopia.allow_event_delete" = 'on'`);
      await tx.load.delete({ where: { id } });
    });
  }

  // -- lifecycle transitions --------------------------------------------
  async post(actor: AuthenticatedActor, id: string): Promise<LoadView> {
    const load = await this.prisma.load.findUnique({ where: { id } });
    if (!load) throw notFound("Load not found");
    assertCanModifyLoad(actor, load);
    assertPermission(actor, Permission.LOAD_POST);

    assertLoadTransition(load.status, LoadStatus.POSTED);
    assertPostReadiness({
      status: load.status,
      originLocationId: load.originLocationId,
      destinationLocationId: load.destinationLocationId,
      equipmentType: load.equipmentType,
      commodity: load.commodity,
      weightLbs: load.weightLbs,
      pickupWindowStart: load.pickupWindowStart,
      pickupWindowEnd: load.pickupWindowEnd,
      deliveryWindowStart: load.deliveryWindowStart,
      deliveryWindowEnd: load.deliveryWindowEnd,
    });

    await this.transition(id, load.status, LoadStatus.POSTED, actor.userId, {
      postedAt: new Date(),
    });
    return this.loadDetail(id);
  }

  async unpost(actor: AuthenticatedActor, id: string): Promise<LoadView> {
    const load = await this.prisma.load.findUnique({ where: { id } });
    if (!load) throw notFound("Load not found");
    assertCanModifyLoad(actor, load);
    assertPermission(actor, Permission.LOAD_UPDATE_OWN);

    assertLoadTransition(load.status, LoadStatus.DRAFT);
    await this.transition(id, load.status, LoadStatus.DRAFT, actor.userId, { postedAt: null });
    return this.loadDetail(id);
  }

  async cancel(actor: AuthenticatedActor, id: string, reason?: string): Promise<LoadView> {
    const load = await this.prisma.load.findUnique({ where: { id } });
    if (!load) throw notFound("Load not found");
    assertCanModifyLoad(actor, load);
    assertPermission(actor, Permission.LOAD_CANCEL_OWN);

    if (!canCancelLoad(load.status)) {
      assertLoadTransition(load.status, LoadStatus.CANCELLED); // throws a precise error
    }
    await this.transition(id, load.status, LoadStatus.CANCELLED, actor.userId, {
      cancelledAt: new Date(),
    }, reason);
    return this.loadDetail(id);
  }

  // -- helpers ---------------------------------------------------------
  private async transition(
    id: string,
    from: LoadStatus,
    to: LoadStatus,
    actorUserId: string,
    extra: Prisma.LoadUncheckedUpdateManyInput,
    note?: string,
  ): Promise<void> {
    assertLoadTransition(from, to);
    if (!M1_EXPOSED_STATUSES.includes(to)) {
      // Defence in depth: Milestone 1 endpoints only ever target DRAFT/POSTED/CANCELLED.
      throw conflict("That transition is not available yet");
    }
    await this.prisma.$transaction(async (tx) => {
      // Atomic compare-and-set: only the row still in `from` is updated. Under
      // concurrent identical transitions the row lock serialises the two
      // `updateMany`s and the second sees `status = to` (not `from`) -> count 0
      // -> 409, so exactly ONE transition and ONE event ever land.
      const result = await tx.load.updateMany({
        where: { id, status: from },
        data: { ...extra, status: to, updatedByUserId: actorUserId },
      });
      if (result.count === 0) {
        throw conflict("The load changed while you were working on it. Reload and try again.");
      }
      await this.appendEvent(
        tx,
        buildStatusChangeEvent({
          loadId: id,
          fromStatus: from,
          toStatus: to,
          actorUserId,
          note,
        }),
      );
    });
  }

  private async appendEvent(
    tx: Prisma.TransactionClient,
    draft: LoadEventDraft,
  ): Promise<void> {
    await tx.loadEvent.create({
      data: {
        loadId: draft.loadId,
        type: draft.type,
        fromStatus: draft.fromStatus,
        toStatus: draft.toStatus,
        actorUserId: draft.actorUserId,
        note: draft.note,
        data: (draft.data ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  private async requireOwnedLocations(companyId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    const rows = await this.prisma.location.findMany({
      where: { id: { in: unique }, companyId, isActive: true },
    });
    const map = new Map(rows.map((r) => [r.id, r]));
    for (const id of unique) {
      if (!map.has(id)) throw notFound("Location not found");
    }
    return map;
  }
}
