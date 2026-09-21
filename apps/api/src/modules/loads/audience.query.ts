import type { Prisma, PrismaClient } from "@loadtopia/db";
import { canonicalizeCompanyPair, isBlockInForce } from "@loadtopia/domain";
import { CompanyBlockStatus, CompanyType, ConnectionStatus } from "@loadtopia/shared";
import type { LoadAudienceStage } from "@loadtopia/shared";

type Db = PrismaClient | Prisma.TransactionClient;

export interface EligibleCarrier {
  companyId: string;
  companyName: string;
  sourceGroupId: string | null;
  sourceGroupName: string | null;
}

/**
 * A shipper's currently ACCEPTED-connected, not-blocked CARRIER companies —
 * the live membership set for the NETWORK stage, and the pool Selected
 * Carriers First revalidates against. Reuses `canAddCarrierToGroup`'s exact
 * rule (ACCEPTED connection + no in-force block) — the same eligibility
 * Carrier Groups already enforce, deliberately not reinvented here.
 */
export async function resolveEligibleNetworkCarriers(
  db: Db,
  shipperCompanyId: string,
): Promise<Map<string, string>> {
  const [connections, blocks] = await Promise.all([
    db.companyConnection.findMany({
      where: {
        status: ConnectionStatus.ACCEPTED,
        OR: [{ companyAId: shipperCompanyId }, { companyBId: shipperCompanyId }],
      },
      include: {
        companyA: { select: { id: true, name: true, type: true } },
        companyB: { select: { id: true, name: true, type: true } },
      },
    }),
    db.companyBlock.findMany({
      where: {
        status: { in: [CompanyBlockStatus.ACTIVE, CompanyBlockStatus.PENDING_ON_COMPLETION] },
        OR: [{ blockingCompanyId: shipperCompanyId }, { blockedCompanyId: shipperCompanyId }],
      },
      select: { blockingCompanyId: true, blockedCompanyId: true, status: true },
    }),
  ]);

  const blockedIds = new Set(
    blocks
      .filter((b) => isBlockInForce(b.status))
      .map((b) => (b.blockingCompanyId === shipperCompanyId ? b.blockedCompanyId : b.blockingCompanyId)),
  );

  const eligible = new Map<string, string>();
  for (const c of connections) {
    const isCompanyA = c.companyAId === shipperCompanyId;
    const counterpart = isCompanyA ? c.companyB : c.companyA;
    const counterpartId = isCompanyA ? c.companyBId : c.companyAId;
    if (counterpart.type !== CompanyType.CARRIER) continue;
    if (blockedIds.has(counterpartId)) continue;
    eligible.set(counterpartId, counterpart.name);
  }
  return eligible;
}

/**
 * Every shipper company that currently has an in-force Block (either
 * direction) against this carrier — used to universally exclude that
 * shipper's freight from this carrier's marketplace/board results,
 * regardless of audience stage (a block always wins — see
 * isCarrierInAudience).
 */
export async function resolveBlockedShipperIds(
  db: Db,
  carrierCompanyId: string,
): Promise<Set<string>> {
  const blocks = await db.companyBlock.findMany({
    where: {
      status: { in: [CompanyBlockStatus.ACTIVE, CompanyBlockStatus.PENDING_ON_COMPLETION] },
      OR: [{ blockingCompanyId: carrierCompanyId }, { blockedCompanyId: carrierCompanyId }],
    },
    select: { blockingCompanyId: true, blockedCompanyId: true },
  });
  return new Set(
    blocks.map((b) => (b.blockingCompanyId === carrierCompanyId ? b.blockedCompanyId : b.blockingCompanyId)),
  );
}

/** Every shipper company this carrier currently holds an ACCEPTED
 *  Connection with — the live membership set for evaluating NETWORK-stage
 *  visibility across a LIST of loads in one query. */
export async function resolveAcceptedShipperIds(
  db: Db,
  carrierCompanyId: string,
): Promise<Set<string>> {
  const connections = await db.companyConnection.findMany({
    where: {
      status: ConnectionStatus.ACCEPTED,
      OR: [{ companyAId: carrierCompanyId }, { companyBId: carrierCompanyId }],
    },
    include: {
      companyA: { select: { id: true, type: true } },
      companyB: { select: { id: true, type: true } },
    },
  });
  const ids = new Set<string>();
  for (const c of connections) {
    const isCompanyA = c.companyAId === carrierCompanyId;
    const counterpart = isCompanyA ? c.companyB : c.companyA;
    const counterpartId = isCompanyA ? c.companyBId : c.companyAId;
    if (counterpart.type === CompanyType.SHIPPER) ids.add(counterpartId);
  }
  return ids;
}

/** Whether a specific carrier currently holds an ACCEPTED, unblocked
 *  Connection with a specific shipper — the single-pair equivalent of
 *  {@link resolveEligibleNetworkCarriers}, used for single-load reads. */
export async function isCarrierNetworkEligible(
  db: Db,
  shipperCompanyId: string,
  carrierCompanyId: string,
): Promise<{ hasAcceptedConnection: boolean; blockInForce: boolean }> {
  const pair = canonicalizeCompanyPair(shipperCompanyId, carrierCompanyId);
  const [connection, block] = await Promise.all([
    db.companyConnection.findUnique({
      where: { companyAId_companyBId: { companyAId: pair.companyAId, companyBId: pair.companyBId } },
      select: { status: true },
    }),
    db.companyBlock.findFirst({
      where: {
        status: { in: [CompanyBlockStatus.ACTIVE, CompanyBlockStatus.PENDING_ON_COMPLETION] },
        OR: [
          { blockingCompanyId: shipperCompanyId, blockedCompanyId: carrierCompanyId },
          { blockingCompanyId: carrierCompanyId, blockedCompanyId: shipperCompanyId },
        ],
      },
      select: { status: true },
    }),
  ]);
  return {
    hasAcceptedConnection: connection?.status === ConnectionStatus.ACCEPTED,
    blockInForce: block != null && isBlockInForce(block.status),
  };
}

/**
 * Writes a frozen audience-member snapshot for one private stage
 * (SELECTED or NETWORK) — the ONLY place `LoadAudienceMember` rows are ever
 * created. Called both at Review & Post (for the strategy's own starting
 * stage) and, separately, inside the release-execution transaction when a
 * SELECTED -> NETWORK hop actually fires (see release-engine.ts). A no-op
 * for an empty member list — an empty NETWORK snapshot at release time is a
 * true, if unfortunate, outcome (nobody currently qualifies), not an error;
 * unlike posting, a scheduled release cannot retroactively be "un-posted".
 * `skipDuplicates` guards the (should-never-happen) case of a snapshot
 * already existing for this exact (load, stage) pair.
 */
export async function freezeAudienceSnapshot(
  db: Db,
  loadId: string,
  strategyId: string,
  stage: typeof LoadAudienceStage.SELECTED | typeof LoadAudienceStage.NETWORK,
  members: readonly EligibleCarrier[],
): Promise<void> {
  if (members.length === 0) return;
  await db.loadAudienceMember.createMany({
    data: members.map((m) => ({
      loadId,
      strategyId,
      stage,
      carrierCompanyId: m.companyId,
      sourceGroupId: m.sourceGroupId,
      sourceGroupName: m.sourceGroupName,
    })),
    skipDuplicates: true,
  });
}

export interface ExpandedAudience {
  eligible: EligibleCarrier[];
  ineligibleCount: number;
}

/**
 * Expands a shipper's Selected Carriers First choice — explicit carrier ids
 * plus any chosen Carrier Groups — to a concrete, deduplicated, currently
 *-eligible carrier list. Group membership is resolved to concrete carrier
 * IDs here and NEVER stored as a live group reference (see
 * LoadAudienceMember's doc comment) — `sourceGroupId`/`sourceGroupName` are
 * carried through purely for audit/display provenance.
 */
export async function expandSelectedAudience(
  db: Db,
  shipperCompanyId: string,
  carrierCompanyIds: readonly string[],
  carrierGroupIds: readonly string[],
): Promise<ExpandedAudience> {
  const [groups, eligibleMap] = await Promise.all([
    carrierGroupIds.length > 0
      ? db.carrierGroup.findMany({
          where: { id: { in: [...carrierGroupIds] }, shipperCompanyId },
          include: { members: { select: { carrierCompanyId: true } } },
        })
      : Promise.resolve([]),
    resolveEligibleNetworkCarriers(db, shipperCompanyId),
  ]);

  // provenance: carrierCompanyId -> {groupId, groupName} (first group wins if
  // a carrier appears via more than one selected group — a display detail).
  const provenance = new Map<string, { groupId: string; groupName: string }>();
  for (const g of groups) {
    for (const m of g.members) {
      if (!provenance.has(m.carrierCompanyId)) {
        provenance.set(m.carrierCompanyId, { groupId: g.id, groupName: g.name });
      }
    }
  }

  const candidateIds = new Set<string>([...carrierCompanyIds, ...provenance.keys()]);

  const eligible: EligibleCarrier[] = [];
  let ineligibleCount = 0;
  for (const id of candidateIds) {
    const name = eligibleMap.get(id);
    if (!name) {
      ineligibleCount++;
      continue;
    }
    const prov = provenance.get(id);
    eligible.push({
      companyId: id,
      companyName: name,
      sourceGroupId: prov?.groupId ?? null,
      sourceGroupName: prov?.groupName ?? null,
    });
  }
  return { eligible, ineligibleCount };
}
