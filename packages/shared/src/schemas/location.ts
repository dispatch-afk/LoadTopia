import { z } from "zod";
import {
  addressLineSchema,
  citySchema,
  countrySchema,
  postalCodeSchema,
  stateSchema,
} from "./common";

export const createLocationSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    addressLine1: addressLineSchema,
    addressLine2: addressLineSchema.optional(),
    city: citySchema,
    state: stateSchema,
    postalCode: postalCodeSchema,
    country: countrySchema,
  })
  .strict();
export type CreateLocationInput = z.infer<typeof createLocationSchema>;

export const updateLocationSchema = z
  .object({
    name: z.string().trim().min(1).max(120).nullable().optional(),
    addressLine1: addressLineSchema.optional(),
    addressLine2: addressLineSchema.nullable().optional(),
    city: citySchema.optional(),
    state: stateSchema.optional(),
    postalCode: postalCodeSchema.optional(),
    country: countrySchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "no fields to update" });
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
