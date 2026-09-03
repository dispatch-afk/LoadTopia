import { z } from "zod";
import { CompanyType, UserRole } from "../enums";
import { emailSchema, passwordSchema } from "./common";

/**
 * Registration creates, atomically: a Company, a User, and a Membership that
 * links them with a role. Phase 0 only allows self-service SHIPPER / CARRIER
 * signup; ADMIN accounts are provisioned out of band.
 */
export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    companyName: z.string().trim().min(2).max(200),
    companyType: z.nativeEnum(CompanyType),
  })
  .strict();
export type RegisterInput = z.infer<typeof registerSchema>;

/** The membership role a self-service signup receives, derived from company type. */
export function roleForCompanyType(type: CompanyType): UserRole {
  return type === CompanyType.SHIPPER ? UserRole.SHIPPER : UserRole.CARRIER;
}

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(128),
  })
  .strict();
export type LoginInput = z.infer<typeof loginSchema>;
