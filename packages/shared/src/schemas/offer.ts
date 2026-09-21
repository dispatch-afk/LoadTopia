import { z } from "zod";
import { OFFER_THREAD_STATUSES } from "../enums";
import { currencySchema, paginationSchema, positiveMoneySchema, uuidSchema } from "./common";

const expiresInHours = z.coerce.number().int().min(1).max(336); // up to 14 days

/** A carrier's initial offer on a marketplace load. */
export const createOfferSchema = z
  .object({
    amount: positiveMoneySchema,
    currency: currencySchema,
    message: z.string().trim().max(1000).optional(),
    expiresInHours: expiresInHours.default(72),
  })
  .strict();
export type CreateOfferInput = z.infer<typeof createOfferSchema>;

/** A counter proposal by the party that did not make the current round. */
export const counterOfferSchema = z
  .object({
    amount: positiveMoneySchema,
    currency: currencySchema,
    message: z.string().trim().max(1000).optional(),
    expiresInHours: expiresInHours.default(72),
  })
  .strict();
export type CounterOfferInput = z.infer<typeof counterOfferSchema>;

/** Accept the current round (finalises → atomic award). Body carries nothing. */
export const acceptOfferSchema = z.object({}).strict();

/**
 * Book at Posted Rate (Milestone 4 Phase 5) — binding commercial acceptance
 * of a shipper's published rate. `confirmedRate` is the EXACT USD amount the
 * carrier saw and explicitly confirmed; the server independently re-reads
 * the load's authoritative `postedRate` inside the award transaction and
 * rejects (409 COMMERCIAL_TERMS_CHANGED) if it no longer matches — the
 * carrier's prior page view is never trusted as authority.
 */
export const bookAtPostedRateSchema = z.object({ confirmedRate: positiveMoneySchema }).strict();
export type BookAtPostedRateInput = z.infer<typeof bookAtPostedRateSchema>;

/** Reject (shipper) / withdraw (carrier) a whole negotiation thread. */
export const closeThreadSchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .strict();
export type CloseThreadInput = z.infer<typeof closeThreadSchema>;

export const roundIdParamSchema = z.object({ roundId: uuidSchema });
export const threadIdParamSchema = z.object({ threadId: uuidSchema });

/** Carrier's "my offers" list. Offset pagination, server-capped (see paginationSchema). */
export const listOfferThreadsSchema = paginationSchema.extend({
  status: z.enum(OFFER_THREAD_STATUSES as [string, ...string[]]).optional(),
});
export type ListOfferThreadsQuery = z.infer<typeof listOfferThreadsSchema>;
