import { z } from "zod";
import { CompanyType, UserRole } from "../enums";
import {
  addressLineSchema,
  citySchema,
  countrySchema,
  emailSchema,
  phoneSchema,
  postalCodeSchema,
  stateSchema,
  uuidSchema,
} from "./common";

const companyName = z.string().trim().min(2).max(200);
const docNumber = z.string().trim().max(32);

/** Address block — every field optional so a company can be completed later. */
const companyAddress = {
  addressLine1: addressLineSchema.optional(),
  addressLine2: addressLineSchema.optional(),
  city: citySchema.optional(),
  state: stateSchema.optional(),
  postalCode: postalCodeSchema.optional(),
  country: countrySchema.optional(),
  phone: phoneSchema.optional(),
  email: emailSchema.optional(),
  mcNumber: docNumber.optional(),
  dotNumber: docNumber.optional(),
};

export const createCompanySchema = z
  .object({
    name: companyName,
    type: z.nativeEnum(CompanyType),
    ...companyAddress,
  })
  .strict();
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

export const updateCompanySchema = z
  .object({
    name: companyName.optional(),
    ...companyAddress,
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "no fields to update" });
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

// --- Memberships ----------------------------------------------------------
export const addMemberSchema = z
  .object({
    email: emailSchema,
    role: z.enum([UserRole.SHIPPER, UserRole.CARRIER]),
  })
  .strict();
export type AddMemberInput = z.infer<typeof addMemberSchema>;

export const updateMembershipSchema = z
  .object({
    role: z.enum([UserRole.SHIPPER, UserRole.CARRIER]).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.role !== undefined || v.isActive !== undefined, {
    message: "no fields to update",
  });
export type UpdateMembershipInput = z.infer<typeof updateMembershipSchema>;

export const switchCompanySchema = z.object({ companyId: uuidSchema }).strict();
export type SwitchCompanyInput = z.infer<typeof switchCompanySchema>;
