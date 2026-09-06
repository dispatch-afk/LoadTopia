import { z } from "zod";
import { citySchema, stateSchema } from "./common";

/**
 * A MANUAL operational check-in: a timestamped city/state observation an
 * authorized carrier user enters for an assigned shipment. Not GPS, not
 * telematics, not device data — see `load_check_ins` in the schema.
 *
 * Only user-entered observation fields are accepted. `loadId`, `actorUserId`,
 * `actorCompanyId`, `recordedAt`, `createdAt`, and the event id are all
 * server-authoritative and rejected here (`.strict()`).
 */
export const createCheckInSchema = z
  .object({
    city: citySchema,
    state: stateSchema,
    note: z.string().trim().max(1000).optional(),
    // Reported coordinates, optional. Finite (so NaN / ±Infinity are rejected)
    // and within valid geographic range. Never derived from city/state.
    latitude: z.number().finite().min(-90).max(90).optional(),
    longitude: z.number().finite().min(-180).max(180).optional(),
  })
  .strict()
  .refine((v) => (v.latitude === undefined) === (v.longitude === undefined), {
    message: "latitude and longitude must be provided together, or not at all",
    path: ["latitude"],
  });

export type CreateCheckInInput = z.infer<typeof createCheckInSchema>;
