import { z } from "zod";
import { EquipmentType, TransportMode } from "../enums";
import { stateSchema, uuidSchema } from "./common";

/**
 * A pricing estimate request. Either supply a `loadId` (the server reads the
 * load's own attributes and persists an immutable PricingSnapshot) OR supply the
 * lane attributes directly for an ad-hoc estimate (no snapshot).
 */
export const pricingEstimateSchema = z
  .union([
    z.object({ loadId: uuidSchema }).strict(),
    z
      .object({
        originState: stateSchema,
        destinationState: stateSchema,
        equipmentType: z.nativeEnum(EquipmentType),
        mode: z.nativeEnum(TransportMode).optional(),
        distanceMeters: z.coerce.number().int().min(0).max(40_000_000).optional(),
        pickupDate: z.string().datetime({ offset: true }).optional(),
      })
      .strict(),
  ])
  .refine(() => true);
export type PricingEstimateInput = z.infer<typeof pricingEstimateSchema>;
