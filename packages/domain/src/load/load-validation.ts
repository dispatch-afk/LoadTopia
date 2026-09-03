import type { LoadStatus } from "@loadtopia/shared";

/**
 * Load business-rule validation. Pure functions — no I/O. The API layer runs
 * these after Zod shape validation and maps failures to `400 VALIDATION_ERROR`.
 * A subset is additionally enforced by CHECK constraints in the database.
 */

export class LoadValidationError extends Error {
  readonly code = "VALIDATION_ERROR";
  readonly statusCode = 400;
  constructor(readonly issues: LoadValidationIssue[]) {
    super(issues[0]?.message ?? "Load validation failed");
    this.name = "LoadValidationError";
  }
}

export interface LoadValidationIssue {
  path: string;
  message: string;
}

export interface LoadWindows {
  pickupWindowStart?: Date | string | null;
  pickupWindowEnd?: Date | string | null;
  deliveryWindowStart?: Date | string | null;
  deliveryWindowEnd?: Date | string | null;
}

function toTime(v: Date | string | null | undefined): number | null {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/**
 * Temporal integrity:
 *  - a window's end may not precede its start
 *  - delivery may not start before pickup starts
 * Missing endpoints are allowed (a DRAFT load can be incomplete).
 */
export function validateLoadWindows(w: LoadWindows): LoadValidationIssue[] {
  const issues: LoadValidationIssue[] = [];
  const ps = toTime(w.pickupWindowStart);
  const pe = toTime(w.pickupWindowEnd);
  const ds = toTime(w.deliveryWindowStart);
  const de = toTime(w.deliveryWindowEnd);

  if (ps !== null && pe !== null && pe < ps) {
    issues.push({ path: "pickupWindowEnd", message: "pickup window end is before its start" });
  }
  if (ds !== null && de !== null && de < ds) {
    issues.push({ path: "deliveryWindowEnd", message: "delivery window end is before its start" });
  }
  if (ps !== null && ds !== null && ds < ps) {
    issues.push({
      path: "deliveryWindowStart",
      message: "delivery cannot start before pickup",
    });
  }
  return issues;
}

export function assertLoadWindows(w: LoadWindows): void {
  const issues = validateLoadWindows(w);
  if (issues.length > 0) throw new LoadValidationError(issues);
}

export interface PostReadinessInput {
  status: LoadStatus;
  originLocationId: string | null;
  destinationLocationId: string | null;
  equipmentType: string | null;
  commodity: string | null;
  weightLbs: number | null;
  pickupWindowStart: Date | string | null;
  pickupWindowEnd: Date | string | null;
  deliveryWindowStart: Date | string | null;
  deliveryWindowEnd: Date | string | null;
}

/**
 * A load must be complete before it can leave DRAFT (be POSTED): both endpoints,
 * equipment, commodity, weight, and both windows fully specified.
 */
export function validatePostReadiness(load: PostReadinessInput): LoadValidationIssue[] {
  const issues: LoadValidationIssue[] = [];
  const req = (cond: boolean, path: string, message: string) => {
    if (!cond) issues.push({ path, message });
  };
  req(!!load.originLocationId, "originLocationId", "origin is required to post a load");
  req(
    !!load.destinationLocationId,
    "destinationLocationId",
    "destination is required to post a load",
  );
  req(!!load.equipmentType, "equipmentType", "equipment type is required to post a load");
  req(!!load.commodity, "commodity", "commodity is required to post a load");
  req(
    load.weightLbs != null && load.weightLbs > 0,
    "weightLbs",
    "a positive weight is required to post a load",
  );
  req(!!load.pickupWindowStart, "pickupWindowStart", "pickup window is required to post a load");
  req(!!load.pickupWindowEnd, "pickupWindowEnd", "pickup window is required to post a load");
  req(
    !!load.deliveryWindowStart,
    "deliveryWindowStart",
    "delivery window is required to post a load",
  );
  req(!!load.deliveryWindowEnd, "deliveryWindowEnd", "delivery window is required to post a load");
  return [...issues, ...validateLoadWindows(load)];
}

export function assertPostReadiness(load: PostReadinessInput): void {
  const issues = validatePostReadiness(load);
  if (issues.length > 0) throw new LoadValidationError(issues);
}
