import { z } from "zod";
import { EquipmentType, LoadCommercialMode, LoadStatus, TransportMode } from "../enums";
import { paginationSchema, positiveMoneySchema, uuidSchema } from "./common";

/** ISO-8601 datetime string (UTC). */
const isoDateTime = z.string().datetime({ offset: true });

const commodity = z.string().trim().min(1).max(200);
const weightLbs = z.coerce.number().int().min(1).max(200_000);

/**
 * Load create/update payload shape. Cross-field temporal rules (delivery not
 * before pickup, window end not before start) are enforced by the domain
 * validator `validateLoadWindows` in @loadtopia/domain, and echoed by a DB CHECK.
 *
 * `commercialMode`/`postedRate` (Milestone 4 Phase 5) are validated for shape
 * only here — always USD, always a positive amount when present. The
 * cross-field rule ("PUBLISH_RATE requires a rate; REQUEST_OFFERS forbids
 * one") is enforced server-side against the MERGED load state in
 * `assertValidCommercialMode` (@loadtopia/domain), never at the schema layer
 * alone, since an `update` may change one field without resending the other.
 */
export const createLoadSchema = z
  .object({
    originLocationId: uuidSchema,
    destinationLocationId: uuidSchema,
    equipmentType: z.nativeEnum(EquipmentType),
    mode: z.nativeEnum(TransportMode).default(TransportMode.FTL),
    commodity: commodity.optional(),
    weightLbs: weightLbs.optional(),
    pickupWindowStart: isoDateTime.optional(),
    pickupWindowEnd: isoDateTime.optional(),
    deliveryWindowStart: isoDateTime.optional(),
    deliveryWindowEnd: isoDateTime.optional(),
    commercialMode: z.nativeEnum(LoadCommercialMode).default(LoadCommercialMode.REQUEST_OFFERS),
    postedRate: positiveMoneySchema.optional(),
  })
  .strict()
  .refine((v) => v.originLocationId !== v.destinationLocationId, {
    message: "origin and destination must be different",
    path: ["destinationLocationId"],
  });
export type CreateLoadInput = z.infer<typeof createLoadSchema>;

export const updateLoadSchema = z
  .object({
    originLocationId: uuidSchema.optional(),
    destinationLocationId: uuidSchema.optional(),
    equipmentType: z.nativeEnum(EquipmentType).optional(),
    mode: z.nativeEnum(TransportMode).optional(),
    commodity: commodity.nullable().optional(),
    weightLbs: weightLbs.nullable().optional(),
    pickupWindowStart: isoDateTime.nullable().optional(),
    pickupWindowEnd: isoDateTime.nullable().optional(),
    deliveryWindowStart: isoDateTime.nullable().optional(),
    deliveryWindowEnd: isoDateTime.nullable().optional(),
    commercialMode: z.nativeEnum(LoadCommercialMode).optional(),
    postedRate: positiveMoneySchema.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "no fields to update" });
export type UpdateLoadInput = z.infer<typeof updateLoadSchema>;

/** Status is NEVER settable via create/update — only via explicit transitions. */
export const cancelLoadSchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .strict();
export type CancelLoadInput = z.infer<typeof cancelLoadSchema>;

/**
 * Coverage grouping (Milestone 4 Phase 10) — a pure read/filter concept over
 * the existing LoadStatus state machine, never a new status. Composes with
 * `status` via AND, not override: `group=NEEDS_COVERAGE&status=POSTED`
 * narrows to POSTED only; an incompatible combination (e.g.
 * `group=COVERED&status=POSTED`) yields zero rows, exactly like any other
 * AND-composed filter pair.
 */
export const coverageGroupSchema = z.enum(["DRAFT", "NEEDS_COVERAGE", "COVERED"]);
export type CoverageGroup = z.infer<typeof coverageGroupSchema>;

export const listLoadsSchema = paginationSchema.extend({
  status: z.nativeEnum(LoadStatus).optional(),
  group: coverageGroupSchema.optional(),
});
export type ListLoadsQuery = z.infer<typeof listLoadsSchema>;
