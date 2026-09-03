import { z } from "zod";
import { currencySchema, positiveMoneySchema, uuidSchema } from "./common";

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

/** Reject (shipper) / withdraw (carrier) a whole negotiation thread. */
export const closeThreadSchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .strict();
export type CloseThreadInput = z.infer<typeof closeThreadSchema>;

export const roundIdParamSchema = z.object({ roundId: uuidSchema });
export const threadIdParamSchema = z.object({ threadId: uuidSchema });
