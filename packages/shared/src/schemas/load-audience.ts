import { z } from "zod";
import { LoadAudienceStage, LoadAudienceStrategyType } from "../enums";
import { uuidSchema } from "./common";

/** ISO-8601 datetime string (UTC). Always the EXACT absolute timestamp the
 *  shipper saw on the Review screen — never an hours-offset re-derived
 *  server-side. */
const isoDateTime = z.string().datetime({ offset: true });

/** One scheduled audience-widening hop. `releaseAt` is the exact timestamp
 *  computed and shown to the shipper before they posted. */
export const audienceReleaseInputSchema = z
  .object({
    toStage: z.enum([LoadAudienceStage.NETWORK, LoadAudienceStage.MARKETPLACE]),
    releaseAt: isoDateTime,
  })
  .strict();
export type AudienceReleaseInput = z.infer<typeof audienceReleaseInputSchema>;

/**
 * Review & Post submission body. Optional at the route level — an omitted
 * body defaults to `{ strategy: "MARKETPLACE" }`, the exact historical
 * immediate-post behavior, so the API contract stays backward compatible
 * while the web Review & Post flow always sends an explicit choice.
 */
export const postLoadAudienceSchema = z.discriminatedUnion("strategy", [
  z.object({ strategy: z.literal(LoadAudienceStrategyType.MARKETPLACE) }).strict(),
  z
    .object({
      strategy: z.literal(LoadAudienceStrategyType.NETWORK_FIRST),
      releases: z.array(audienceReleaseInputSchema).max(1).default([]),
    })
    .strict(),
  z
    .object({
      strategy: z.literal(LoadAudienceStrategyType.SELECTED_FIRST),
      carrierCompanyIds: z.array(uuidSchema).max(200).default([]),
      carrierGroupIds: z.array(uuidSchema).max(50).default([]),
      releases: z.array(audienceReleaseInputSchema).max(2).default([]),
    })
    .strict(),
  // Note: "at least one carrier/group selected, and at least one resolves to
  // a currently-eligible carrier" is enforced server-side against live data
  // in AudienceService#applyAudienceAtPosting (§36 Empty Audience) — a
  // schema-level non-empty check here could never see eligibility anyway,
  // and z.discriminatedUnion requires plain ZodObject members (no .refine).
]);
export type PostLoadAudienceInput = z.infer<typeof postLoadAudienceSchema>;

/** Same shape as the posting body — used for the non-authoritative
 *  audience preview shown on the Review screen before commit. */
export const audiencePreviewSchema = postLoadAudienceSchema;
export type AudiencePreviewInput = z.infer<typeof audiencePreviewSchema>;

export const rescheduleReleaseSchema = z
  .object({ releaseAt: isoDateTime })
  .strict();
export type RescheduleReleaseInput = z.infer<typeof rescheduleReleaseSchema>;

export const releaseNowSchema = z
  .object({ target: z.enum([LoadAudienceStage.NETWORK, LoadAudienceStage.MARKETPLACE]) })
  .strict();
export type ReleaseNowInput = z.infer<typeof releaseNowSchema>;
