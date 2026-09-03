import { z } from "zod";

export const uuidSchema = z.string().uuid();

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

/**
 * Password policy: length is the primary strength lever. 12–128 chars.
 * (NIST SP 800-63B: favor length, do not impose composition rules.)
 */
export const passwordSchema = z.string().min(12).max(128);

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
});
export type Pagination = z.infer<typeof paginationSchema>;

/** Monetary amounts cross the wire as strings and are stored as SQL NUMERIC. */
export const moneySchema = z
  .string()
  .regex(/^-?\d{1,12}(\.\d{1,2})?$/, "must be a decimal string with up to 2 places");

export const currencySchema = z.string().length(3).default("USD");
