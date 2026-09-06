import type { Prisma, PrismaClient } from "@loadtopia/db";
import {
  assertCanModifyLoad,
  assertCanOperateShipment,
  assertCanReadLoad,
  assertLoadTransition,
  assertPermission,
  assertPostReadiness,
  assertLoadWindows,
  buildLoadCreatedEvent,
  buildLoadUpdatedEvent,
  canCancelLoad,
  formatLoadNumber,
  loadViewerRole,
  Permission,
  type LoadEventDraft,
} from "@loadtopia/domain";
import { MOCK_PROVIDER_NAME, type ProviderRegistry } from "@loadtopia/providers";
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
import { AppError, badRequest, conflict, notFound } from "../../lib/errors";
import { appendLoadEvent, atomicLoadTransition } from "../../lib/load-lifecycle";
import { paginate, toSkipTake } from "../../lib/pagination";
import { PricingService } from "../pricing/pricing.service";
import { loadDetailInclude, loadListInclude, toLoadListItem, toLoadView } from "./loads.serializer";
import { computeRouting } from "./routing";

const parseDate = (v: string | null | undefined): Date | null => (v == null ? null : new Date(v));

export class LoadsService {
  private readonly pricing: PricingService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly providers: ProviderRegistry,
    private readonly log: { warn: (obj: unknown, msg: string) => void },
  ) {
    this.pricing = new PricingService(prisma, providers.pricing);
  }

  private async loadDetail(id: string, actor: AuthenticatedActor): Promise<LoadView> {
    const row = await this.prisma.load.findUniqueOrThrow({
      where: { id },
      include: loadDetailInclude,
    });
    // `availableTransitions` is actor-aware — see loads.serializer.
    return toLoadView(row, loadViewerRole(actor, row));
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
          actorCompanyId: actor.companyId,
          initialStatus: LoadStatus.DRAFT,
        }),
      );
      return load.id;
    });

    return this.loadDetail(id, actor);
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
    return this.loadDetail(id, actor);
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
      // Row lock + a fresh status re-check: the load was read (and computeRouting
      // — network I/O — was run) BEFORE this transaction opened. If a concurrent
      // post() committed DRAFT -> POSTED in the meantime, this stale write must
      // never land on the now-POSTED load. Locking first means we either wait
      // behind post()'s own lock (see below) and then see the fresh status here,
      // or we win the race and post() waits behind us instead — either way only
      // one of the two can succeed against the load as it actually is.
      await tx.$executeRaw`SELECT 1 FROM loads WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.load.findUniqueOrThrow({ where: { id }, select: { status: true } });
      if (current.status !== LoadStatus.DRAFT) {
        throw conflict("Only a DRAFT load can be edited. Withdraw the load to DRAFT first.");
      }

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
        buildLoadUpdatedEvent({
          loadId: id,
          actorUserId: actor.userId,
          actorCompanyId: actor.companyId,
          changedFields,
        }),
      );
    });

    return this.loadDetail(id, actor);
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

    const routingIsMock = this.providers.routing.isMock;

    await this.prisma.$transaction(async (tx) => {
      // Row lock FIRST, then re-read the authoritative state: everything this
      // guard depends on (status, post-readiness fields, routing provenance)
      // is validated against the load AS IT ACTUALLY IS at commit time, not a
      // stale pre-transaction read. A concurrent update() attempting to
      // mutate the same row (e.g. swapping in a still-unrouted location) is
      // forced to serialize against this lock — see loads.service.ts#update().
      await tx.$executeRaw`SELECT 1 FROM loads WHERE id = ${id}::uuid FOR UPDATE`;
      const fresh = await tx.load.findUniqueOrThrow({ where: { id } });

      assertLoadTransition(fresh.status, LoadStatus.POSTED);
      assertPostReadiness({
        status: fresh.status,
        originLocationId: fresh.originLocationId,
        destinationLocationId: fresh.destinationLocationId,
        equipmentType: fresh.equipmentType,
        commodity: fresh.commodity,
        weightLbs: fresh.weightLbs,
        pickupWindowStart: fresh.pickupWindowStart,
        pickupWindowEnd: fresh.pickupWindowEnd,
        deliveryWindowStart: fresh.deliveryWindowStart,
        deliveryWindowEnd: fresh.deliveryWindowEnd,
      });

      // Production routing invariant: under a REAL (non-mock) routing
      // provider, POSTED marketplace freight must carry a genuine, non-mock
      // route. `routingProvider` — not just `distanceMeters` — must be
      // present and must not be the mock marker, so a historical load whose
      // persisted route came from MockRoutingProvider can never reach the
      // marketplace once production has cut over to a real provider. This is
      // provider-neutral (checks "not mock", never a specific provider name)
      // so a future second real provider needs no change here. Mock routing
      // never fails and is never the mock marker under itself, so this can't
      // block local/CI/test posting.
      if (
        !routingIsMock &&
        (fresh.distanceMeters == null ||
          fresh.routingProvider == null ||
          fresh.routingProvider === MOCK_PROVIDER_NAME)
      ) {
        throw conflict(
          "Route mileage could not be calculated. Verify the origin and destination and retry routing before posting.",
        );
      }

      await atomicLoadTransition(tx, {
        id,
        from: fresh.status,
        to: LoadStatus.POSTED,
        actorUserId: actor.userId,
        actorCompanyId: actor.companyId,
        extra: { postedAt: new Date() },
      });
    });

    // Capture an immutable pricing snapshot at post time so the price the
    // marketplace was posted at is always reproducible. Best-effort — a pricing
    // hiccup must never block posting the load.
    const lane = await this.prisma.load.findUniqueOrThrow({
      where: { id },
      select: {
        equipmentType: true,
        mode: true,
        distanceMeters: true,
        origin: { select: { state: true } },
        destination: { select: { state: true } },
      },
    });
    await this.pricing.snapshotForLoad(
      this.prisma,
      {
        id,
        equipmentType: lane.equipmentType,
        mode: lane.mode,
        distanceMeters: lane.distanceMeters,
        originState: lane.origin.state,
        destinationState: lane.destination.state,
      },
      actor.userId,
      this.log,
    );

    return this.loadDetail(id, actor);
  }

  /**
   * `AWARDED → CARRIER_ASSIGNED`. The shipper confirms the awarded carrier is
   * assigned to run the load. (The carrier was set atomically at award time.)
   */
  async assign(actor: AuthenticatedActor, id: string): Promise<LoadView> {
    const load = await this.prisma.load.findUnique({ where: { id } });
    if (!load) throw notFound("Load not found");
    assertCanModifyLoad(actor, load);
    assertPermission(actor, Permission.LOAD_UPDATE_OWN);

    assertLoadTransition(load.status, LoadStatus.CARRIER_ASSIGNED);
    if (!load.carrierCompanyId) {
      throw conflict("This load has no awarded carrier to assign");
    }
    await this.transition(
      id,
      load.status,
      LoadStatus.CARRIER_ASSIGNED,
      actor.userId,
      actor.companyId,
      { assignedAt: new Date() },
    );
    return this.loadDetail(id, actor);
  }

  // -- Milestone 3: carrier operational lifecycle ----------------------
  //
  // The assigned carrier reports the physical movement of the freight:
  //   CARRIER_ASSIGNED → PICKED_UP → IN_TRANSIT → DELIVERED
  //
  // These are the FIRST load transitions a carrier is ever allowed to drive.
  // Authority is `canOperateShipment()` (the assigned carrier company, or admin)
  // — deliberately NOT `canModifyLoad()`, which stays shipper-only and untouched.
  // DELIVERED → COMPLETED is shipper-owned and intentionally not exposed here;
  // it gates on approved-POD readiness, which lands in a later slice.

  /** `CARRIER_ASSIGNED → PICKED_UP`. Assigned carrier only. Sets `pickedUpAt`. */
  async pickup(actor: AuthenticatedActor, id: string): Promise<LoadView> {
    return this.operationalTransition(actor, id, LoadStatus.PICKED_UP, {
      pickedUpAt: true,
    });
  }

  /** `PICKED_UP → IN_TRANSIT`. Assigned carrier only. No timestamp column;
   *  `pickedUpAt` is never rewritten. */
  async startTransit(actor: AuthenticatedActor, id: string): Promise<LoadView> {
    return this.operationalTransition(actor, id, LoadStatus.IN_TRANSIT, {});
  }

  /** `IN_TRANSIT → DELIVERED`. Assigned carrier only. Sets `deliveredAt`.
   *  Physical delivery is reported independently of any POD paperwork. */
  async deliver(actor: AuthenticatedActor, id: string): Promise<LoadView> {
    return this.operationalTransition(actor, id, LoadStatus.DELIVERED, {
      deliveredAt: true,
    });
  }

  /**
   * Shared carrier-operational transition. Server-authoritative end to end:
   * fresh-read → authorize against THIS load → row lock → re-read status under
   * the lock → validate the exact transition → compare-and-set + immutable
   * event, all in one transaction with a single authoritative `now`.
   *
   * Never reroutes, reprices, creates a pricing snapshot, or touches the Rate
   * Confirmation — a transition only advances `status` and its own timestamp.
   */
  private async operationalTransition(
    actor: AuthenticatedActor,
    id: string,
    to: LoadStatus,
    stamp: { pickedUpAt?: true; deliveredAt?: true },
  ): Promise<LoadView> {
    const load = await this.prisma.load.findUnique({
      where: { id },
      select: { shipperCompanyId: true, carrierCompanyId: true, status: true },
    });
    if (!load) throw notFound("Load not found");
    // 404 for anyone who cannot even read the load (unassigned/losing/cross-company
    // carriers); 403 for a reader who is not the assigned carrier (e.g. the shipper).
    assertCanOperateShipment(actor, load);
    assertPermission(actor, Permission.SHIPMENT_OPERATE_ASSIGNED);

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM loads WHERE id = ${id}::uuid FOR UPDATE`;
      const fresh = await tx.load.findUniqueOrThrow({
        where: { id },
        select: { status: true, carrierCompanyId: true },
      });
      // Re-authorize against the load AS IT ACTUALLY IS under the lock — a
      // concurrent cancellation (or any status move) is rejected here or by the
      // compare-and-set below, never silently applied to a stale view.
      assertCanOperateShipment(actor, {
        shipperCompanyId: load.shipperCompanyId,
        carrierCompanyId: fresh.carrierCompanyId,
        status: fresh.status,
      });

      const now = new Date();
      await atomicLoadTransition(tx, {
        id,
        from: fresh.status,
        to,
        actorUserId: actor.userId,
        actorCompanyId: actor.companyId,
        extra: {
          ...(stamp.pickedUpAt ? { pickedUpAt: now } : {}),
          ...(stamp.deliveredAt ? { deliveredAt: now } : {}),
        },
        note: `carrier reported ${to.toLowerCase().replace(/_/g, " ")}`,
      });
    });

    return this.loadDetail(id, actor);
  }

  /**
   * `DELIVERED → COMPLETED`. SHIPPER-owned (never the carrier) — uses
   * `canModifyLoad` + `LOAD_UPDATE_OWN`, exactly like {@link assign}. Gated by
   * completion readiness, evaluated as a PURE DATABASE query INSIDE the
   * load-locked transaction: at least one POD row for this load that is
   * confirmed, `review_status = APPROVED`, and `removed_at IS NULL`. No
   * StorageProvider call — a later object-store outage cannot invalidate an
   * already-established approved-POD review (Decision 5). No payment,
   * invoicing, or settlement side effect — this is operational completion only.
   */
  async complete(actor: AuthenticatedActor, id: string): Promise<LoadView> {
    const load = await this.prisma.load.findUnique({ where: { id } });
    if (!load) throw notFound("Load not found");
    assertCanModifyLoad(actor, load);
    assertPermission(actor, Permission.LOAD_UPDATE_OWN);

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM loads WHERE id = ${id}::uuid FOR UPDATE`;
      const fresh = await tx.load.findUniqueOrThrow({
        where: { id },
        select: { status: true, shipperCompanyId: true, carrierCompanyId: true },
      });
      assertCanModifyLoad(actor, fresh);
      assertLoadTransition(fresh.status, LoadStatus.COMPLETED); // precise 409 unless DELIVERED

      const approvedPod = await tx.loadDocument.findFirst({
        where: {
          loadId: id,
          docType: "POD",
          confirmedAt: { not: null },
          reviewStatus: "APPROVED",
          removedAt: null,
        },
        select: { id: true },
      });
      if (!approvedPod) {
        throw new AppError(
          409,
          "COMPLETION_NOT_READY",
          "This shipment cannot be completed until an uploaded POD has been reviewed and approved.",
        );
      }

      await atomicLoadTransition(tx, {
        id,
        from: fresh.status,
        to: LoadStatus.COMPLETED,
        actorUserId: actor.userId,
        actorCompanyId: actor.companyId,
        extra: { completedAt: new Date() },
        note: "shipper closed out the shipment",
      });
    });

    return this.loadDetail(id, actor);
  }

  async unpost(actor: AuthenticatedActor, id: string): Promise<LoadView> {
    const load = await this.prisma.load.findUnique({ where: { id } });
    if (!load) throw notFound("Load not found");
    assertCanModifyLoad(actor, load);
    assertPermission(actor, Permission.LOAD_UPDATE_OWN);

    assertLoadTransition(load.status, LoadStatus.DRAFT);
    await this.transition(
      id,
      load.status,
      LoadStatus.DRAFT,
      actor.userId,
      actor.companyId,
      { postedAt: null },
    );
    return this.loadDetail(id, actor);
  }

  async cancel(actor: AuthenticatedActor, id: string, reason?: string): Promise<LoadView> {
    const load = await this.prisma.load.findUnique({ where: { id } });
    if (!load) throw notFound("Load not found");
    assertCanModifyLoad(actor, load);
    assertPermission(actor, Permission.LOAD_CANCEL_OWN);

    if (!canCancelLoad(load.status)) {
      assertLoadTransition(load.status, LoadStatus.CANCELLED); // throws a precise error
    }
    await this.transition(
      id,
      load.status,
      LoadStatus.CANCELLED,
      actor.userId,
      actor.companyId,
      { cancelledAt: new Date() },
      reason,
    );
    return this.loadDetail(id, actor);
  }

  // -- helpers ---------------------------------------------------------
  private async transition(
    id: string,
    from: LoadStatus,
    to: LoadStatus,
    actorUserId: string,
    actorCompanyId: string | null,
    extra: Prisma.LoadUncheckedUpdateManyInput,
    note?: string,
  ): Promise<void> {
    await this.prisma.$transaction((tx) =>
      atomicLoadTransition(tx, { id, from, to, actorUserId, actorCompanyId, extra, note }),
    );
  }

  private async appendEvent(tx: Prisma.TransactionClient, draft: LoadEventDraft): Promise<void> {
    await appendLoadEvent(tx, draft);
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
