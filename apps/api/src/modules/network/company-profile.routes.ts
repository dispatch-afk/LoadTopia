import { Permission } from "@loadtopia/domain";
import { uuidSchema } from "@loadtopia/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CompanyProfileService } from "./company-profile.service";

const idParam = z.object({ id: uuidSchema });

export async function companyProfileRoutes(app: FastifyInstance): Promise<void> {
  const service = new CompanyProfileService(app.prisma);

  app.get(
    "/companies/:id/profile",
    { preHandler: [app.requireCompanyPermission(Permission.NETWORK_REQUEST)] },
    async (request) => {
      const { id } = idParam.parse(request.params);
      return service.getProfile(request.currentUser!, id);
    },
  );
}
