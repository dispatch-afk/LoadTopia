import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@loadtopia/db";
import type { PricingProvider } from "@loadtopia/providers";
import {
  type EquipmentType,
  type PricingEstimateInput,
  type PricingEstimateView,
  type PricingSnapshotView,
  type TransportMode,
} from "@loadtopia/shared";
import { assertCanModifyLoad } from "@loadtopia/domain";
import type { AuthenticatedActor } from "@loadtopia/shared";
import { notFound } from "../../lib/errors";
import { money, ratePerMile } from "../../lib/money";

interface LaneInputs {
  originState: string;
  destinationState: string;
  equipmentType: EquipmentType;
  mode?: TransportMode;
  distanceMeters: number | null;
  pickupDate?: string;
}

function inputsHash(i: LaneInputs): string {
  return createHash("sha256")
    .update(
      [
        i.originState.toUpperCase(),
        i.destinationState.toUpperCase(),
        i.equipmentType,
        i.mode ?? "",
        i.distanceMeters ?? "",
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 16);
}

type SnapshotRow = Prisma.PricingSnapshotGetPayload<Record<string, never>>;

function toSnapshotView(s: SnapshotRow): PricingSnapshotView {
  return {
    id: s.id,
    loadId: s.loadId,
    provider: s.provider,
    isMock: s.isMock,
    currency: s.currency,
    lowRate: money(s.lowRate),
    midRate: money(s.midRate),
    highRate: money(s.highRate),
    ratePerMile: ratePerMile(s.ratePerMile),
    confidence: s.confidence,
    disclaimer: s.disclaimer,
    distanceMeters: s.distanceMeters,
    createdAt: s.createdAt.toISOString(),
  };
}

export class PricingService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly pricing: PricingProvider,
  ) {}

  private async runProvider(inputs: LaneInputs): Promise<PricingEstimateView> {
    const result = await this.pricing.estimate({
      originRegion: inputs.originState,
      destinationRegion: inputs.destinationState,
      equipmentType: inputs.equipmentType,
      distanceMeters: inputs.distanceMeters ?? undefined,
      pickupDate: inputs.pickupDate,
    });
    return {
      currency: result.currency,
      lowRate: money(result.lowRate),
      midRate: money(result.midRate),
      highRate: money(result.highRate),
      ratePerMile: result.ratePerMile,
      confidence: result.confidence,
      provider: result.provider,
      isMock: result.isMock,
      disclaimer: result.disclaimer,
      distanceMeters: inputs.distanceMeters,
      retrievedAt: result.retrievedAt,
      snapshotId: null,
    };
  }

  /**
   * A pricing estimate. With `loadId`, the server reads the load's own
   * attributes and persists an IMMUTABLE PricingSnapshot (a historical price is
   * then reproducible). Ad-hoc lane estimates are not persisted.
   */
  async estimate(actor: AuthenticatedActor, input: PricingEstimateInput): Promise<PricingEstimateView> {
    if ("loadId" in input) {
      const load = await this.prisma.load.findUnique({
        where: { id: input.loadId },
        select: {
          shipperCompanyId: true,
          carrierCompanyId: true,
          equipmentType: true,
          mode: true,
          distanceMeters: true,
          origin: { select: { state: true } },
          destination: { select: { state: true } },
        },
      });
      if (!load) throw notFound("Load not found");
      assertCanModifyLoad(actor, load);

      const inputs: LaneInputs = {
        originState: load.origin.state,
        destinationState: load.destination.state,
        equipmentType: load.equipmentType,
        mode: load.mode,
        distanceMeters: load.distanceMeters,
      };
      const estimate = await this.runProvider(inputs);

      const snapshot = await this.prisma.pricingSnapshot.create({
        data: {
          loadId: input.loadId,
          provider: estimate.provider,
          isMock: estimate.isMock,
          currency: estimate.currency,
          lowRate: estimate.lowRate,
          midRate: estimate.midRate,
          highRate: estimate.highRate,
          ratePerMile: estimate.ratePerMile,
          confidence: estimate.confidence,
          disclaimer: estimate.disclaimer,
          distanceMeters: inputs.distanceMeters,
          equipmentType: inputs.equipmentType,
          originState: inputs.originState,
          destinationState: inputs.destinationState,
          inputsHash: inputsHash(inputs),
          createdByUserId: actor.userId,
        },
      });
      return { ...estimate, snapshotId: snapshot.id };
    }

    return this.runProvider({
      originState: input.originState,
      destinationState: input.destinationState,
      equipmentType: input.equipmentType,
      mode: input.mode,
      distanceMeters: input.distanceMeters ?? null,
      pickupDate: input.pickupDate,
    });
  }

  /**
   * Persist a snapshot for a load without returning a full estimate — used at
   * post time. Never throws (a pricing hiccup must not block posting a load).
   */
  async snapshotForLoad(
    tx: Prisma.TransactionClient | PrismaClient,
    load: {
      id: string;
      equipmentType: EquipmentType;
      mode: TransportMode;
      distanceMeters: number | null;
      originState: string;
      destinationState: string;
    },
    actorUserId: string,
    log: { warn: (o: unknown, m: string) => void },
  ): Promise<void> {
    try {
      const inputs: LaneInputs = {
        originState: load.originState,
        destinationState: load.destinationState,
        equipmentType: load.equipmentType,
        mode: load.mode,
        distanceMeters: load.distanceMeters,
      };
      const e = await this.runProvider(inputs);
      await tx.pricingSnapshot.create({
        data: {
          loadId: load.id,
          provider: e.provider,
          isMock: e.isMock,
          currency: e.currency,
          lowRate: e.lowRate,
          midRate: e.midRate,
          highRate: e.highRate,
          ratePerMile: e.ratePerMile,
          confidence: e.confidence,
          disclaimer: e.disclaimer,
          distanceMeters: inputs.distanceMeters,
          equipmentType: inputs.equipmentType,
          originState: inputs.originState,
          destinationState: inputs.destinationState,
          inputsHash: inputsHash(inputs),
          createdByUserId: actorUserId,
        },
      });
    } catch (err) {
      log.warn({ err, loadId: load.id }, "pricing snapshot at post time failed; continuing");
    }
  }

  async listForLoad(actor: AuthenticatedActor, loadId: string): Promise<PricingSnapshotView[]> {
    const load = await this.prisma.load.findUnique({
      where: { id: loadId },
      select: { shipperCompanyId: true, carrierCompanyId: true },
    });
    if (!load) throw notFound("Load not found");
    assertCanModifyLoad(actor, load);
    const rows = await this.prisma.pricingSnapshot.findMany({
      where: { loadId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toSnapshotView);
  }
}
