export interface SharedHistoryAggregates {
  totalCount: number;
  completedCount: number;
  activeCount: number;
  lastAwardedAt: Date | null;
}

export interface SharedHistorySummaryData {
  shipmentsTogether: number;
  completedShipments: number;
  activeShipments: number;
  lastWorkedTogether: string | null;
}

/**
 * Pure shaping of raw aggregate counts (from grouped Prisma queries — see
 * CompanyProfileService/ConnectionsService) into the summary shape the API
 * returns. Kept separate from DB orchestration so the shaping itself is
 * unit-testable without a database, and so the "how do we count" and "how do
 * we query efficiently" concerns stay independent.
 */
export function summarizeSharedHistory(aggregates: SharedHistoryAggregates): SharedHistorySummaryData {
  return {
    shipmentsTogether: aggregates.totalCount,
    completedShipments: aggregates.completedCount,
    activeShipments: aggregates.activeCount,
    lastWorkedTogether: aggregates.lastAwardedAt ? aggregates.lastAwardedAt.toISOString() : null,
  };
}
