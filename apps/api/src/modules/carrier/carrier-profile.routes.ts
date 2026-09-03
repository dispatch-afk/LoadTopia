import { upsertCarrierProfileSchema } from "@loadtopia/shared";
import type { FastifyInstance } from "fastify";
import { writeAudit } from "../../lib/audit";
import { CarrierProfileService } from "./carrier-profile.service";

export async function carrierProfileRoutes(app: FastifyInstance): Promise<void> {
  const service = new CarrierProfileService(app.prisma, app.providers.carrierVerification);

  app.get(
    "/carrier/profile",
    { preHandler: [app.requireCompanyPermission("carrier:profile:manage")] },
    async (request) => {
      const actor = request.currentUser!;
      const profile = await service.getOwn(actor.companyId!, actor.companyType);
      return { profile };
    },
  );

  app.put(
    "/carrier/profile",
    { preHandler: [app.requireCompanyPermission("carrier:profile:manage")] },
    async (request) => {
      const actor = request.currentUser!;
      const input = upsertCarrierProfileSchema.parse(request.body);
      const profile = await service.upsertOwn(actor.companyId!, actor.companyType, input);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "carrier_profile.updated",
        entityType: "carrier_profile",
        entityId: profile.id,
        data: { companyId: actor.companyId },
      });
      return { profile };
    },
  );

  app.post(
    "/carrier/profile/verify",
    { preHandler: [app.requireCompanyPermission("carrier:profile:manage")] },
    async (request) => {
      const actor = request.currentUser!;
      const profile = await service.verifyOwn(actor.companyId!);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "carrier_profile.verified",
        entityType: "carrier_profile",
        entityId: profile.id,
        data: {
          verificationStatus: profile.verification.status,
          isMock: profile.verification.isMock,
          eligibility: profile.marketplaceEligibility,
        },
      });
      return { profile };
    },
  );
}
