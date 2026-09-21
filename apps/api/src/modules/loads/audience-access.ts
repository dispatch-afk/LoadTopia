import type { Prisma, PrismaClient } from "@loadtopia/db";
import { isCarrierInAudience } from "@loadtopia/domain";
import { LoadAudienceStage } from "@loadtopia/shared";
import { isCarrierNetworkEligible } from "./audience.query";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Single-load carrier audience visibility check — the AUDIENCE conjunct of
 * `carrierCanSeeLoad = loadIsPostedAndVisible AND carrierIsEligible AND
 * carrierIsInCurrentAudience`. Callers still separately check load status
 * (posted/visible) and `isCarrierEligibleForLoad` (equipment/service-area/
 * profile) — this function only answers "is this carrier currently IN the
 * audience for this specific load".
 *
 * For a private stage (SELECTED or NETWORK), membership requires BOTH a
 * frozen `LoadAudienceMember` row captured for the load's CURRENT stage AND
 * a live ACCEPTED connection right now — a snapshot alone is historical
 * truth, never standing authorization (Phase 4 review corrections #1/#2).
 */
export async function isLoadVisibleToCarrier(
  db: Db,
  carrierCompanyId: string,
  load: { id: string; shipperCompanyId: string },
): Promise<boolean> {
  const strategy = await db.loadAudienceStrategyRecord.findUnique({
    where: { loadId: load.id },
    select: { id: true, currentStage: true },
  });

  if (!strategy) {
    // Legacy load: still must respect a block, universally.
    const { blockInForce } = await isCarrierNetworkEligible(
      db,
      load.shipperCompanyId,
      carrierCompanyId,
    );
    return isCarrierInAudience({
      hasStrategyRecord: false,
      currentStage: null,
      isCurrentStageMember: false,
      hasAcceptedConnection: false,
      blockInForce,
    });
  }

  const isPrivateStage = strategy.currentStage !== LoadAudienceStage.MARKETPLACE;

  const [member, network] = await Promise.all([
    isPrivateStage
      ? db.loadAudienceMember.findUnique({
          where: {
            loadId_stage_carrierCompanyId: {
              loadId: load.id,
              stage: strategy.currentStage,
              carrierCompanyId,
            },
          },
          select: { id: true },
        })
      : Promise.resolve(null),
    isCarrierNetworkEligible(db, load.shipperCompanyId, carrierCompanyId),
  ]);

  return isCarrierInAudience({
    hasStrategyRecord: true,
    currentStage: strategy.currentStage,
    isCurrentStageMember: member != null,
    hasAcceptedConnection: network.hasAcceptedConnection,
    blockInForce: network.blockInForce,
  });
}
