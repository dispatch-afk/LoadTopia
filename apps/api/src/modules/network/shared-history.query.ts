import type { Prisma, PrismaClient } from "@loadtopia/db";
import { ACTIVE_FREIGHT_STATUSES, summarizeSharedHistory, type SharedHistorySummaryData } from "@loadtopia/domain";
import { CompanyType, LoadStatus, type SharedLaneView } from "@loadtopia/shared";

type Db = Prisma.TransactionClient | PrismaClient;

const ACTIVE_STATUS_LIST = [...ACTIVE_FREIGHT_STATUSES];

function pairWhere(companyAId: string, companyBId: string): Prisma.LoadWhereInput {
  return {
    OR: [
      { shipperCompanyId: companyAId, carrierCompanyId: companyBId },
      { shipperCompanyId: companyBId, carrierCompanyId: companyAId },
    ],
  };
}

export const ZERO_SHARED_HISTORY: SharedHistorySummaryData = {
  shipmentsTogether: 0,
  completedShipments: 0,
  activeShipments: 0,
  lastWorkedTogether: null,
};

/**
 * Verified shared-history summary for ONE company pair (Company Profile
 * detail page — a single profile view, so three cheap counts are fine).
 * Counts ONLY awarded freight (Load.carrierCompanyId set) — a losing offer
 * thread or a cancelled pre-award load is never counted, because
 * carrierCompanyId is only ever written at award time (see
 * OffersService.accept()).
 */
export async function getSharedHistorySummary(
  db: Db,
  companyAId: string,
  companyBId: string,
): Promise<SharedHistorySummaryData> {
  const where = pairWhere(companyAId, companyBId);
  const [totalCount, completedCount, activeCount, latest] = await Promise.all([
    db.load.count({ where }),
    db.load.count({ where: { ...where, status: LoadStatus.COMPLETED } }),
    db.load.count({ where: { ...where, status: { in: ACTIVE_STATUS_LIST } } }),
    db.load.findFirst({ where, orderBy: { awardedAt: "desc" }, select: { awardedAt: true } }),
  ]);
  return summarizeSharedHistory({
    totalCount,
    completedCount,
    activeCount,
    lastAwardedAt: latest?.awardedAt ?? null,
  });
}

/** The most recent verified shared loads for one pair — bounded (default 5),
 *  for the "Shared Freight" section of a Relationship Profile. */
export async function getRecentSharedLanes(
  db: Db,
  companyAId: string,
  companyBId: string,
  limit = 5,
): Promise<SharedLaneView[]> {
  const loads = await db.load.findMany({
    where: pairWhere(companyAId, companyBId),
    orderBy: { awardedAt: "desc" },
    take: limit,
    select: {
      id: true,
      referenceNumber: true,
      status: true,
      awardedAt: true,
      completedAt: true,
      origin: { select: { city: true, state: true } },
      destination: { select: { city: true, state: true } },
    },
  });
  return loads
    .filter((l): l is typeof l & { awardedAt: Date } => l.awardedAt !== null)
    .map((l) => ({
      loadId: l.id,
      referenceNumber: l.referenceNumber,
      origin: l.origin,
      destination: l.destination,
      status: l.status,
      awardedAt: l.awardedAt.toISOString(),
      completedAt: l.completedAt?.toISOString() ?? null,
    }));
}

function buildSummaryMap(
  totals: Array<{ _count: { _all: number }; _max: { awardedAt: Date | null } }>,
  completed: Array<{ _count: { _all: number } }>,
  active: Array<{ _count: { _all: number } }>,
  keyOf: (row: { [k: string]: unknown }) => string,
): Map<string, SharedHistorySummaryData> {
  const completedByKey = new Map(completed.map((r) => [keyOf(r), r._count._all]));
  const activeByKey = new Map(active.map((r) => [keyOf(r), r._count._all]));
  const map = new Map<string, SharedHistorySummaryData>();
  for (const row of totals) {
    const key = keyOf(row);
    map.set(
      key,
      summarizeSharedHistory({
        totalCount: row._count._all,
        completedCount: completedByKey.get(key) ?? 0,
        activeCount: activeByKey.get(key) ?? 0,
        lastAwardedAt: row._max.awardedAt,
      }),
    );
  }
  return map;
}

/**
 * Verified shared-history summary for a WHOLE LIST of counterparts in one
 * shot — exactly 3 grouped queries total, regardless of how many
 * counterparts are being rendered (no N+1: never one query per row). Used by
 * the Network workspace's Connected/Requests list.
 */
export async function getSharedHistoryBatch(
  db: Db,
  myCompanyId: string,
  myCompanyType: CompanyType,
  counterpartIds: string[],
): Promise<Map<string, SharedHistorySummaryData>> {
  if (counterpartIds.length === 0) return new Map();

  if (myCompanyType === CompanyType.SHIPPER) {
    const base = { shipperCompanyId: myCompanyId, carrierCompanyId: { in: counterpartIds } };
    const [totals, completed, active] = await Promise.all([
      db.load.groupBy({
        by: ["carrierCompanyId"],
        where: base,
        _count: { _all: true },
        _max: { awardedAt: true },
      }),
      db.load.groupBy({
        by: ["carrierCompanyId"],
        where: { ...base, status: LoadStatus.COMPLETED },
        _count: { _all: true },
      }),
      db.load.groupBy({
        by: ["carrierCompanyId"],
        where: { ...base, status: { in: ACTIVE_STATUS_LIST } },
        _count: { _all: true },
      }),
    ]);
    return buildSummaryMap(totals, completed, active, (r) => r.carrierCompanyId as string);
  }

  const base = { carrierCompanyId: myCompanyId, shipperCompanyId: { in: counterpartIds } };
  const [totals, completed, active] = await Promise.all([
    db.load.groupBy({
      by: ["shipperCompanyId"],
      where: base,
      _count: { _all: true },
      _max: { awardedAt: true },
    }),
    db.load.groupBy({
      by: ["shipperCompanyId"],
      where: { ...base, status: LoadStatus.COMPLETED },
      _count: { _all: true },
    }),
    db.load.groupBy({
      by: ["shipperCompanyId"],
      where: { ...base, status: { in: ACTIVE_STATUS_LIST } },
      _count: { _all: true },
    }),
  ]);
  return buildSummaryMap(totals, completed, active, (r) => r.shipperCompanyId as string);
}
