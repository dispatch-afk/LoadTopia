import type { Prisma, PrismaClient } from "@loadtopia/db";
import { assertCompanyScope, assertPermission, Permission } from "@loadtopia/domain";
import {
  type AddMemberInput,
  type AuthenticatedActor,
  type CompanyMemberView,
  type CompanyView,
  type CreateCompanyInput,
  roleForCompanyType,
  type UpdateCompanyInput,
  type UpdateMembershipInput,
} from "@loadtopia/shared";
import { generateUniqueLoadNumberPrefix } from "../../lib/company-prefix";
import { badRequest, conflict, notFound } from "../../lib/errors";

type CompanyRow = Prisma.CompanyGetPayload<Record<string, never>>;

function toCompanyView(c: CompanyRow): CompanyView {
  return {
    id: c.id,
    type: c.type,
    name: c.name,
    mcNumber: c.mcNumber,
    dotNumber: c.dotNumber,
    addressLine1: c.addressLine1,
    addressLine2: c.addressLine2,
    city: c.city,
    state: c.state,
    postalCode: c.postalCode,
    country: c.country,
    phone: c.phone,
    email: c.email,
    loadNumberPrefix: c.loadNumberPrefix,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

const addressData = (input: UpdateCompanyInput | CreateCompanyInput) => ({
  ...(input.name !== undefined ? { name: input.name } : {}),
  ...(input.addressLine1 !== undefined ? { addressLine1: input.addressLine1 } : {}),
  ...(input.addressLine2 !== undefined ? { addressLine2: input.addressLine2 } : {}),
  ...(input.city !== undefined ? { city: input.city } : {}),
  ...(input.state !== undefined ? { state: input.state } : {}),
  ...(input.postalCode !== undefined ? { postalCode: input.postalCode } : {}),
  ...(input.country !== undefined ? { country: input.country } : {}),
  ...(input.phone !== undefined ? { phone: input.phone } : {}),
  ...(input.email !== undefined ? { email: input.email } : {}),
  ...(input.mcNumber !== undefined ? { mcNumber: input.mcNumber } : {}),
  ...(input.dotNumber !== undefined ? { dotNumber: input.dotNumber } : {}),
});

export class CompaniesService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Create a new company and enrol the creator as an active member. */
  async create(actor: AuthenticatedActor, input: CreateCompanyInput): Promise<CompanyView> {
    assertPermission(actor, Permission.COMPANY_CREATE);
    const role = roleForCompanyType(input.type);

    try {
      const company = await this.prisma.$transaction(async (tx) => {
        const loadNumberPrefix = await generateUniqueLoadNumberPrefix(tx, input.name);
        return tx.company.create({
          data: {
            ...addressData(input),
            name: input.name,
            type: input.type,
            loadNumberPrefix,
            memberships: {
              create: { userId: actor.userId, role, isPrimary: false, isActive: true },
            },
          },
        });
      });
      return toCompanyView(company);
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        throw conflict("A company with that name and type already exists");
      }
      throw err;
    }
  }

  async getById(actor: AuthenticatedActor, id: string): Promise<CompanyView> {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) throw notFound("Company not found");
    assertCompanyScope(actor, company.id);
    return toCompanyView(company);
  }

  async update(
    actor: AuthenticatedActor,
    id: string,
    input: UpdateCompanyInput,
  ): Promise<CompanyView> {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) throw notFound("Company not found");
    assertCompanyScope(actor, company.id);
    assertPermission(actor, Permission.COMPANY_UPDATE_OWN);

    try {
      const updated = await this.prisma.company.update({
        where: { id },
        data: addressData(input),
      });
      return toCompanyView(updated);
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        throw conflict("A company with that name and type already exists");
      }
      throw err;
    }
  }

  async listMembers(actor: AuthenticatedActor, companyId: string): Promise<CompanyMemberView[]> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw notFound("Company not found");
    assertCompanyScope(actor, company.id);
    assertPermission(actor, Permission.MEMBERSHIP_READ);

    const members = await this.prisma.membership.findMany({
      where: { companyId },
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });

    return members.map((m) => ({
      membershipId: m.id,
      userId: m.user.id,
      email: m.user.email,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      role: m.role,
      isPrimary: m.isPrimary,
      isActive: m.isActive,
      createdAt: m.createdAt.toISOString(),
    }));
  }

  /**
   * Add an existing user to the company. There is no invite-email flow in
   * Milestone 1 (that is a notification concern); the target user must already
   * have a LoadTopia account.
   */
  async addMember(
    actor: AuthenticatedActor,
    companyId: string,
    input: AddMemberInput,
  ): Promise<CompanyMemberView> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw notFound("Company not found");
    assertCompanyScope(actor, company.id);
    assertPermission(actor, Permission.MEMBERSHIP_MANAGE);

    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user) {
      throw notFound("No LoadTopia user has that email address");
    }

    const existing = await this.prisma.membership.findUnique({
      where: { userId_companyId: { userId: user.id, companyId } },
    });
    if (existing) {
      if (existing.isActive) throw conflict("That user is already a member of this company");
      const reactivated = await this.prisma.membership.update({
        where: { id: existing.id },
        data: { isActive: true, role: input.role },
      });
      return this.memberView(reactivated.id);
    }

    const membership = await this.prisma.membership.create({
      data: { userId: user.id, companyId, role: input.role, isPrimary: false, isActive: true },
    });
    return this.memberView(membership.id);
  }

  async updateMembership(
    actor: AuthenticatedActor,
    membershipId: string,
    input: UpdateMembershipInput,
  ): Promise<CompanyMemberView> {
    const membership = await this.prisma.membership.findUnique({ where: { id: membershipId } });
    if (!membership) throw notFound("Membership not found");
    assertCompanyScope(actor, membership.companyId);
    assertPermission(actor, Permission.MEMBERSHIP_MANAGE);

    if (input.isActive === false && membership.userId === actor.userId) {
      throw badRequest("You cannot deactivate your own membership");
    }

    const data = {
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.isActive === false) {
        // Serialise concurrent deactivations for this company by locking the
        // company row first, so the "keep >= 1 active member" invariant cannot
        // be raced past by two admins deactivating the last two members at once.
        await tx.$executeRaw`SELECT 1 FROM companies WHERE id = ${membership.companyId}::uuid FOR UPDATE`;
        const othersActive = await tx.membership.count({
          where: { companyId: membership.companyId, isActive: true, id: { not: membershipId } },
        });
        if (othersActive < 1) {
          throw badRequest("A company must keep at least one active member");
        }
      }
      return tx.membership.update({ where: { id: membershipId }, data });
    });
    return this.memberView(updated.id);
  }

  private async memberView(membershipId: string): Promise<CompanyMemberView> {
    const m = await this.prisma.membership.findUniqueOrThrow({
      where: { id: membershipId },
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
    });
    return {
      membershipId: m.id,
      userId: m.user.id,
      email: m.user.email,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      role: m.role,
      isPrimary: m.isPrimary,
      isActive: m.isActive,
      createdAt: m.createdAt.toISOString(),
    };
  }
}
