import { z } from "zod";
import { EquipmentType, LoadStatus, TransportMode } from "../enums";
import { paginationSchema, uuidSchema } from "./common";

/** ISO-8601 datetime string (UTC). */
const isoDateTime = z.string().datetime({ offset: true });

const commodity = z.string().trim().min(1).max(200);
const weightLbs = z.coerce.number().int().min(1).max(200_000);

/**
 * Load create/update payload shape. Cross-field temporal rules (delivery not
 * before pickup, window end not before start) are enforced by the domain
 * validator `validateLoadWindows` in @loadtopia/domain, and echoed by a DB CHECK.
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
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "no fields to update" });
export type UpdateLoadInput = z.infer<typeof updateLoadSchema>;

/** Status is NEVER settable via create/update — only via explicit transitions. */
export const cancelLoadSchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .strict();
export type CancelLoadInput = z.infer<typeof cancelLoadSchema>;

export const listLoadsSchema = paginationSchema.extend({
  status: z.nativeEnum(LoadStatus).optional(),
});
export type ListLoadsQuery = z.infer<typeof listLoadsSchema>;
