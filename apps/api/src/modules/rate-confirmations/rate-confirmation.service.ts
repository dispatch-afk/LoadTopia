import type { PrismaClient } from "@loadtopia/db";
import { assertCanReadLoad } from "@loadtopia/domain";
import type { AuthenticatedActor, RateConfirmationView } from "@loadtopia/shared";
import type { StorageProvider } from "@loadtopia/providers";
import { AppError, notFound } from "../../lib/errors";
import { renderRateConfirmationPdf } from "./rate-confirmation.pdf";
import { toRateConfirmationView } from "./rate-confirmation.serializer";

type MinimalLogger = { warn: (obj: unknown, msg: string) => void };

/** The narrow surface `OffersService` needs for the post-commit phase-2 hook. */
export interface RateConfirmationGenerator {
  generateAfterAward(loadId: string): Promise<void>;
}

/**
 * Phase 2 of the Rate Confirmation lifecycle (rendering + storage) and the
 * authorized retrieval path.
 *
 * Phase 1 — the immutable commercial snapshot INSERT — is NOT here: it lives in
 * `rate-confirmation.snapshot.ts` and runs inside `OffersService.accept()`'s
 * award transaction, with zero dependency on this service or on storage.
 *
 * Everything in this service is best-effort and idempotent. A render or storage
 * failure never converts a committed award into an API failure; it only means
 * the rendered PDF is not available yet, and a later retrieval retries.
 */
export class RateConfirmationService implements RateConfirmationGenerator {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: StorageProvider,
    private readonly log: MinimalLogger,
  ) {}

  /**
   * Post-commit hook for `OffersService.accept()`. Best-effort — always
   * resolves, never throws, so a storage outage cannot roll back or fail an
   * award that has already committed.
   */
  async generateAfterAward(loadId: string): Promise<void> {
    await this.generate(loadId);
  }

  /**
   * Render the immutable snapshot to a PDF and store it under the deterministic
   * key, then flip generation metadata to GENERATED. Idempotent: a retry
   * re-renders byte-identical content to the SAME key and re-affirms the same
   * metadata. Never throws.
   */
  private async generate(loadId: string): Promise<void> {
    try {
      const rc = await this.prisma.rateConfirmation.findUnique({ where: { loadId } });
      if (!rc || !rc.storageKey) return;

      if (rc.status === "GENERATED") {
        // Trust GENERATED only if the object is actually there. A transient
        // head failure is left alone — retrieval will retry.
        let present: boolean;
        try {
          present = (await this.storage.headObject(rc.storageKey)) !== null;
        } catch {
          return;
        }
        if (present) return;
        // GENERATED but the object is gone — fall through and re-render.
      }

      const body = renderRateConfirmationPdf(rc);
      await this.storage.putObject({
        key: rc.storageKey,
        contentType: "application/pdf",
        body,
      });

      // headObject establishes storage facts only — it does NOT prove the bytes
      // are a valid PDF, and is not malware/content validation.
      const confirmed = (await this.storage.headObject(rc.storageKey)) !== null;
      if (confirmed) {
        await this.prisma.rateConfirmation.updateMany({
          where: { loadId },
          data: { status: "GENERATED", generatedAt: new Date() },
        });
      } else {
        await this.prisma.rateConfirmation.updateMany({
          where: { loadId, status: { not: "GENERATED" } },
          data: { status: "FAILED" },
        });
        this.log.warn(
          { loadId },
          "rate confirmation: object storage did not confirm the written PDF",
        );
      }
    } catch (err) {
      this.log.warn(
        { loadId, err },
        "rate confirmation generation failed (best-effort, retryable)",
      );
      await this.prisma.rateConfirmation
        .updateMany({
          where: { loadId, status: { not: "GENERATED" } },
          data: { status: "FAILED" },
        })
        .catch(() => {});
    }
  }

  /** Resolve a short-lived signed download, but ONLY when storage confirms the
   *  object exists — never a dead URL for a GENERATED-but-missing row. */
  private async tryDownload(
    storageKey: string | null,
    status: string,
  ): Promise<{ url: string; expiresAt: string } | null> {
    if (status !== "GENERATED" || !storageKey) return null;
    try {
      const head = await this.storage.headObject(storageKey);
      if (!head) return null;
      const dl = await this.storage.createSignedDownload(storageKey);
      return { url: dl.url, expiresAt: dl.expiresAt };
    } catch {
      return null;
    }
  }

  /**
   * Authorized retrieval. Authorization is derived entirely from the owning
   * load (`canReadLoad`): the owning shipper, the assigned/winning carrier, and
   * admin — every other caller gets a 404, never a 403 (IDOR-safe). If no
   * snapshot row exists (any load awarded before this feature shipped), a
   * stable `RATE_CONFIRMATION_NOT_AVAILABLE` is returned — never a snapshot
   * fabricated from current data.
   */
  async getForLoad(actor: AuthenticatedActor, loadId: string): Promise<RateConfirmationView> {
    const load = await this.prisma.load.findUnique({
      where: { id: loadId },
      select: { shipperCompanyId: true, carrierCompanyId: true },
    });
    if (!load) throw notFound("Load not found");
    assertCanReadLoad(actor, load);

    let rc = await this.prisma.rateConfirmation.findUnique({ where: { loadId } });
    if (!rc) {
      throw new AppError(
        404,
        "RATE_CONFIRMATION_NOT_AVAILABLE",
        "No rate confirmation exists for this load",
      );
    }

    let download = await this.tryDownload(rc.storageKey, rc.status);
    if (!download) {
      // Lazily complete (or reconcile) generation, then try once more.
      await this.generate(loadId);
      rc = await this.prisma.rateConfirmation.findUniqueOrThrow({ where: { loadId } });
      download = await this.tryDownload(rc.storageKey, rc.status);
    }

    return toRateConfirmationView(rc, download);
  }
}
