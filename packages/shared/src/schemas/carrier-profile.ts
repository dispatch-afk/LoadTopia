import { z } from "zod";
import { CarrierOperatingStatus, EquipmentType } from "../enums";
import { stateSchema } from "./common";

const docNumber = z.string().trim().max(32);

/**
 * Create-or-replace the carrier's own marketplace profile. Editing identity or
 * capabilities resets marketplace eligibility to PENDING server-side (the
 * carrier must re-verify) — the client cannot set eligibility or verification.
 */
export const upsertCarrierProfileSchema = z
  .object({
    legalName: z.string().trim().min(2).max(200),
    mcNumber: docNumber.optional(),
    dotNumber: docNumber.optional(),
    operatingStatus: z.nativeEnum(CarrierOperatingStatus).default(CarrierOperatingStatus.ACTIVE),
    equipmentTypes: z.array(z.nativeEnum(EquipmentType)).max(20).default([]),
    serviceAreaStates: z.array(stateSchema).max(60).default([]),
  })
  .strict();
export type UpsertCarrierProfileInput = z.infer<typeof upsertCarrierProfileSchema>;

/** Admin override of a carrier's marketplace eligibility. */
export const adminSetEligibilitySchema = z
  .object({
    marketplaceEligibility: z.enum(["ELIGIBLE", "INELIGIBLE", "SUSPENDED", "PENDING"]),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();
export type AdminSetEligibilityInput = z.infer<typeof adminSetEligibilitySchema>;
