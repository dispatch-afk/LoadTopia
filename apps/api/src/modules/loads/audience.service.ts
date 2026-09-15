import type { Prisma, PrismaClient } from "@loadtopia/db";
import {
  assertCanModifyLoad,
  assertValidReleaseChain,
  buildLoadPostedEvent,
  buildReleaseScheduledEvent,
  initialStageFor,
} from "@loadtopia/domain";
import {
  type AudiencePreviewInput,
  type AudiencePreviewView,
  type AuthenticatedActor,
  LoadAudienceStrategyType,
  type PostLoadAudienceInput,
} from "@loadtopia/shared";
import { appendLoadEvent } from "../../lib/load-lifecycle";
import { conflict, notFound } from "../../lib/errors";
import { enforceLoadFacilityScope } from "../../lib/facility-scope";
import {
  expandSelectedAudience,
  freezeAudienceSnapshot,
  resolveEligibleNetworkCarriers,
} from "./audience.query";

type Tx = Prisma.TransactionClient;

/** Shared "how many carriers would this strategy currently reach" resolver —
 *  used by both the non-authoritative preview and the authoritative posting
 *  path, so they can never disagree about WHAT counts as eligible, only about
 *  WHEN each is evaluated (preview: at preview time; posting: revalidated
 *  fresh at commit time — see {@link applyAudienceAtPosting}). */
async function resolveAudience(
  db: PrismaClient | Tx,
  shipperCompanyId: string,
  input: PostLoadAudienceInput,
): Promise<{
  eligibleCount: number | null;
  ineligibleSelectedCount: number;
  members: { companyId: string; companyName: string; sourceGroupId: string | null; sourceGroupName: string | null }[];
}> {
  if (input.strategy === LoadAudienceStrategyType.MARKETPLACE) {
    return { eligibleCount: null, ineligibleSelectedCount: 0, members: [] };
  }
  if (input.strategy === LoadAudienceStrategyType.NETWORK_FIRST) {
    const eligible = await resolveEligibleNetworkCarriers(db, shipperCompanyId);
    const members = [...eligible].map(([companyId, companyName]) => ({
      companyId,
      companyName,
      sourceGroupId: null,
      sourceGroupName: null,
    }));
    return { eligibleCount: eligible.size, ineligibleSelectedCount: 0, members };
  }
  const { eligible, ineligibleCount } = await expandSelectedAudience(
    db,
    shipperCompanyId,
    input.carrierCompanyIds,
    input.carrierGroupIds,
  );
  return {
    eligibleCount: eligible.length,
    ineligibleSelectedCount: ineligibleCount,
    members: eligible,
  };
}

export class AudienceService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Non-authoritative preview shown on the Review & Post screen before the
   * shipper commits. ALWAYS revalidated fresh at actual posting time — see
   * §35 (Preview vs Commit) — a carrier that was eligible at preview time
   * may not be by the time the shipper clicks Post, and posting uses
   * whatever is true at that moment, never this cached number.
   */
  async preview(
    actor: AuthenticatedActor,
    loadId: string,
    input: AudiencePreviewInput,
  ): Promise<AudiencePreviewView> {
    const load = await this.prisma.load.findUnique({ where: { id: loadId } });
    if (!load) throw notFound("Load not found");
    assertCanModifyLoad(actor, load);
    await enforceLoadFacilityScope(this.prisma, actor, load);

    const resolved = await resolveAudience(this.prisma, load.shipperCompanyId, input);
    return {
      strategy: input.strategy,
      eligibleCarrierCount: resolved.eligibleCount,
      ineligibleSelectedCount: resolved.ineligibleSelectedCount,
    };
  }

  /**
   * Runs INSIDE the caller's existing DRAFT -> POSTED transaction, immediately
   * after that compare-and-set commits (see LoadsService#post). Creates the
   * strategy record, the frozen SELECTED-stage snapshot (if any), and any
   * requested release rows — all authoritative, freshly revalidated against
   * the database as it exists AT THIS MOMENT under the load's row lock, never
   * against the (possibly stale) preview the shipper saw earlier.
   *
   * Throws (rolling back the whole posting transaction, per §17 "no partial
   * audience state") when the resolved audience would be empty for a
   * strategy that requires one — see §36 (Empty Audience).
   */
  async applyAudienceAtPosting(
    tx: Tx,
    actor: AuthenticatedActor,
    loadId: string,
    shipperCompanyId: string,
    input: PostLoadAudienceInput,
    now: Date,
  ): Promise<{ audienceCount: number | null }> {
    const releases =
      input.strategy === LoadAudienceStrategyType.MARKETPLACE
        ? []
        : input.releases.map((r) => ({ toStage: r.toStage, releaseAt: new Date(r.releaseAt) }));
    assertValidReleaseChain(input.strategy, releases, now);

    const resolved = await resolveAudience(tx, shipperCompanyId, input);
    if (input.strategy !== LoadAudienceStrategyType.MARKETPLACE && resolved.eligibleCount === 0) {
      throw conflict(
        input.strategy === LoadAudienceStrategyType.NETWORK_FIRST
          ? "You have no eligible connected carriers to post to yet. Connect with a carrier first, or choose Marketplace."
          : "None of the selected carriers are currently eligible (connected and unblocked). Adjust your selection, or choose Marketplace.",
      );
    }

    // A load can be posted more than once over its life (post -> unpost ->
    // edit -> post again is an intentional, documented feature — see
    // LoadsService#unpost). Each posting is a FRESH audience decision: any
    // mutable execution state left over from a PRIOR posting — its strategy
    // record, its frozen member snapshot(s), and any pending/executed
    // release rows — must never leak into or block this one. The immutable
    // history of that prior posting (LOAD_POSTED, RELEASE_SCHEDULED,
    // RELEASE_CANCELLED, AUDIENCE_RELEASED LoadEvents) is untouched by this
    // delete; it lives on forever as an append-only fact log. This delete
    // cascades at the DB level (`load_audience_members`/`load_audience_releases`
    // both FK to `load_audience_strategies` with `ON DELETE CASCADE`), and is
    // a no-op for a load's first-ever posting. Old release rows are removed
    // rather than marked CANCELLED because there is nothing further for them
    // to do or say once superseded — the fact that they were scheduled is
    // already permanently recorded in LoadEvents, and a stale row is a
    // strictly worse hazard than no row.
    await tx.loadAudienceStrategyRecord.deleteMany({ where: { loadId } });

    const strategy = await tx.loadAudienceStrategyRecord.create({
      data: {
        loadId,
        strategy: input.strategy,
        currentStage: initialStageFor(input.strategy),
        autoReleaseDisabled:
          input.strategy !== LoadAudienceStrategyType.MARKETPLACE && releases.length === 0,
        createdByUserId: actor.userId,
      },
    });

    // Freeze the initial private-stage snapshot (SELECTED for Selected
    // Carriers First, NETWORK for Network First) — MARKETPLACE never gets
    // one, it stays open to all otherwise-eligible carriers (review
    // correction #2). This is the ONLY moment this snapshot is ever
    // written for this stage of this load; group/connection changes made
    // afterward never touch it.
    if (input.strategy !== LoadAudienceStrategyType.MARKETPLACE) {
      const stage = initialStageFor(input.strategy) as "SELECTED" | "NETWORK";
      await freezeAudienceSnapshot(tx, loadId, strategy.id, stage, resolved.members);
    }

    // Each release records the exact stage its OWN execution requires the
    // strategy's currentStage to equal — derived once, here, from the
    // chain position (never re-derived from process-local order or poll
    // timing at execution time; see release-engine.ts).
    let fromStage = initialStageFor(input.strategy);
    for (const r of releases) {
      await tx.loadAudienceRelease.create({
        data: {
          loadId,
          strategyId: strategy.id,
          fromStage,
          toStage: r.toStage,
          scheduledAt: r.releaseAt,
          createdByUserId: actor.userId,
        },
      });
      await appendLoadEvent(
        tx,
        buildReleaseScheduledEvent({
          loadId,
          actorUserId: actor.userId,
          actorCompanyId: actor.companyId,
          toStage: r.toStage as "NETWORK" | "MARKETPLACE",
          releaseAt: r.releaseAt.toISOString(),
        }),
      );
      fromStage = r.toStage;
    }

    await appendLoadEvent(
      tx,
      buildLoadPostedEvent({
        loadId,
        actorUserId: actor.userId,
        actorCompanyId: actor.companyId,
        strategy: input.strategy,
        audienceCount: resolved.eligibleCount,
      }),
    );

    return { audienceCount: resolved.eligibleCount };
  }
}
