import { z } from "zod";
import { EquipmentType, TransportMode } from "../enums";
import { paginationSchema, stateSchema } from "./common";

const isoDate = z.string().datetime({ offset: true });

/**
 * Carrier load-board search. Offset pagination (M1 convention); page size is
 * server-capped by `paginationSchema`. The `WHERE` this maps to is isolated in
 * the marketplace service so a future PostGIS / search backend can replace it
 * without touching the marketplace domain.
 */
export const marketplaceSearchSchema = paginationSchema.extend({
  originState: stateSchema.optional(),
  destinationState: stateSchema.optional(),
  equipmentType: z.nativeEnum(EquipmentType).optional(),
  mode: z.nativeEnum(TransportMode).optional(),
  pickupFrom: isoDate.optional(),
  pickupTo: isoDate.optional(),
  minMiles: z.coerce.number().int().min(0).max(20000).optional(),
  maxMiles: z.coerce.number().int().min(0).max(20000).optional(),
  sort: z.enum(["newest", "pickup", "miles"]).default("newest"),
});
export type MarketplaceSearchQuery = z.infer<typeof marketplaceSearchSchema>;
