import { z } from "zod";

export const uuidSchema = z.string().uuid();

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

/**
 * Password policy: length is the primary strength lever. 12–128 chars.
 * (NIST SP 800-63B: favor length, do not impose composition rules.)
 */
export const passwordSchema = z.string().min(12).max(128);

/** Offset pagination for list endpoints. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type Pagination = z.infer<typeof paginationSchema>;

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Monetary amounts cross the wire as strings and are stored as SQL NUMERIC. */
export const moneySchema = z
  .string()
  .regex(/^-?\d{1,12}(\.\d{1,2})?$/, "must be a decimal string with up to 2 places");

export const currencySchema = z.string().length(3).default("USD");

// --- Address components (US/CA freight) ------------------------------------
export const stateSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "must be a 2-letter state/province code");

export const postalCodeSchema = z
  .string()
  .trim()
  .min(3)
  .max(10)
  .regex(/^[A-Za-z0-9 -]+$/, "invalid postal code");

export const countrySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/)
  .default("US");

export const phoneSchema = z
  .string()
  .trim()
  .min(7)
  .max(32)
  .regex(/^[0-9 +().-]+$/, "invalid phone number");

export const addressLineSchema = z.string().trim().min(1).max(200);
export const citySchema = z.string().trim().min(1).max(120);
