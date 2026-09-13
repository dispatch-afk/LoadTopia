import { z } from "zod";
import { CarrierPreferenceType } from "../enums";
import { uuidSchema } from "./common";

// --- Carrier preference -----------------------------------------------------

export const setCarrierPreferenceSchema = z
  .object({
    preference: z.nativeEnum(CarrierPreferenceType),
  })
  .strict();
export type SetCarrierPreferenceInput = z.infer<typeof setCarrierPreferenceSchema>;

// --- Carrier groups ----------------------------------------------------------

const carrierGroupName = z.string().trim().min(2).max(100);

export const createCarrierGroupSchema = z.object({ name: carrierGroupName }).strict();
export type CreateCarrierGroupInput = z.infer<typeof createCarrierGroupSchema>;

export const updateCarrierGroupSchema = z.object({ name: carrierGroupName }).strict();
export type UpdateCarrierGroupInput = z.infer<typeof updateCarrierGroupSchema>;

export const addCarrierGroupMemberSchema = z.object({ carrierCompanyId: uuidSchema }).strict();
export type AddCarrierGroupMemberInput = z.infer<typeof addCarrierGroupMemberSchema>;

// --- Facility scope -----------------------------------------------------------

/** Full-replace semantics: the membership's scope becomes EXACTLY this list.
 *  An empty array means company-wide access (no scope rows at all). */
export const setFacilityScopeSchema = z
  .object({
    locationIds: z.array(uuidSchema).max(200),
  })
  .strict();
export type SetFacilityScopeInput = z.infer<typeof setFacilityScopeSchema>;
