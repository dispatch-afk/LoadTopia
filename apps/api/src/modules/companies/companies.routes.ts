import {
  addMemberSchema,
  createCompanySchema,
  updateCompanySchema,
  updateMembershipSchema,
  uuidSchema,
} from "@loadtopia/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { writeAudit } from "../../lib/audit";
import { unauthorized } from "../../lib/errors";
import { assertResourceScope } from "../../lib/scoped-resource";
import { CompaniesService } from "./companies.service";

const idParam = z.object({ id: uuidSchema });
const membershipIdParam = z.object({ membershipId: uuidSchema });

export async function companiesRoutes(app: FastifyInstance): Promise<void> {
  const service = new CompaniesService(app.prisma);

  app.post(
    "/companies",
    { preHandler: [app.requirePermission("company:create")] },
    async (request, reply) => {
      const actor = request.currentUser!;
      const input = createCompanySchema.parse(request.body);
      const company = await service.create(actor, input);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "company.create",
        entityType: "company",
        entityId: company.id,
        data: { type: company.type },
      });
      reply.status(201);
      return company;
    },
  );

  app.get("/companies/:id", { preHandler: [app.authenticate] }, async (request) => {
    const actor = request.currentUser;
    if (!actor) throw unauthorized();
    const { id } = idParam.parse(request.params);
    return service.getById(actor, id);
  });

  app.patch("/companies/:id", { preHandler: [app.authenticate] }, async (request) => {
    const actor = request.currentUser;
    if (!actor) throw unauthorized();
    const { id } = idParam.parse(request.params);
    await assertResourceScope(app.prisma, actor, "company", id);
    const input = updateCompanySchema.parse(request.body);
    const company = await service.update(actor, id, input);
    await writeAudit(app.prisma, request, {
      actorUserId: actor.userId,
      action: "company.update",
      entityType: "company",
      entityId: id,
      data: { fields: Object.keys(input) },
    });
    return company;
  });

  app.get("/companies/:id/members", { preHandler: [app.authenticate] }, async (request) => {
    const actor = request.currentUser;
    if (!actor) throw unauthorized();
    const { id } = idParam.parse(request.params);
    return { data: await service.listMembers(actor, id) };
  });

  app.post("/companies/:id/members", { preHandler: [app.authenticate] }, async (request, reply) => {
    const actor = request.currentUser;
    if (!actor) throw unauthorized();
    const { id } = idParam.parse(request.params);
    await assertResourceScope(app.prisma, actor, "company", id);
    const input = addMemberSchema.parse(request.body);
    const member = await service.addMember(actor, id, input);
    await writeAudit(app.prisma, request, {
      actorUserId: actor.userId,
      action: "membership.add",
      entityType: "membership",
      entityId: member.membershipId,
      data: { companyId: id, role: member.role },
    });
    reply.status(201);
    return member;
  });

  app.patch("/memberships/:membershipId", { preHandler: [app.authenticate] }, async (request) => {
    const actor = request.currentUser;
    if (!actor) throw unauthorized();
    const { membershipId } = membershipIdParam.parse(request.params);
    await assertResourceScope(app.prisma, actor, "membership", membershipId);
    const input = updateMembershipSchema.parse(request.body);
    const member = await service.updateMembership(actor, membershipId, input);
    await writeAudit(app.prisma, request, {
      actorUserId: actor.userId,
      action: "membership.update",
      entityType: "membership",
      entityId: membershipId,
      data: { fields: Object.keys(input) },
    });
    return member;
  });
}
