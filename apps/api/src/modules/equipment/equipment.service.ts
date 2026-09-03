import type { Prisma, PrismaClient } from "@loadtopia/db";
import { assertCompanyScope, assertPermission, Permission } from "@loadtopia/domain";
import type {
  AuthenticatedActor,
  CreateEquipmentInput,
  EquipmentView,
  Paginated,
  Pagination,
  UpdateEquipmentInput,
} from "@loadtopia/shared";
import { notFound } from "../../lib/errors";
import { paginate, toSkipTake } from "../../lib/pagination";

type EquipmentRow = Prisma.EquipmentGetPayload<Record<string, never>>;

export function toEquipmentView(e: EquipmentRow): EquipmentView {
  return {
    id: e.id,
    companyId: e.companyId,
    type: e.type,
    name: e.name,
    trailerLengthFt: e.trailerLengthFt,
    capacityLbs: e.capacityLbs,
    description: e.description,
    isActive: e.isActive,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

export class EquipmentService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    actor: AuthenticatedActor,
    companyId: string,
    input: CreateEquipmentInput,
  ): Promise<EquipmentView> {
    assertPermission(actor, Permission.EQUIPMENT_MANAGE);
    const created = await this.prisma.equipment.create({
      data: {
        companyId,
        type: input.type,
        name: input.name ?? null,
        trailerLengthFt: input.trailerLengthFt ?? null,
        capacityLbs: input.capacityLbs ?? null,
        description: input.description ?? null,
      },
    });
    return toEquipmentView(created);
  }

  async list(
    actor: AuthenticatedActor,
    companyId: string,
    p: Pagination & { includeInactive?: boolean },
  ): Promise<Paginated<EquipmentView>> {
    assertPermission(actor, Permission.EQUIPMENT_READ);
    const where: Prisma.EquipmentWhereInput = {
      companyId,
      ...(p.includeInactive ? {} : { isActive: true }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.equipment.findMany({
        where,
        orderBy: [{ isActive: "desc" }, { type: "asc" }, { createdAt: "desc" }],
        ...toSkipTake(p),
      }),
      this.prisma.equipment.count({ where }),
    ]);
    return paginate(rows.map(toEquipmentView), total, p);
  }

  async getById(actor: AuthenticatedActor, id: string): Promise<EquipmentView> {
    assertPermission(actor, Permission.EQUIPMENT_READ);
    const eq = await this.prisma.equipment.findUnique({ where: { id } });
    if (!eq) throw notFound("Equipment not found");
    assertCompanyScope(actor, eq.companyId);
    return toEquipmentView(eq);
  }

  async update(
    actor: AuthenticatedActor,
    id: string,
    input: UpdateEquipmentInput,
  ): Promise<EquipmentView> {
    assertPermission(actor, Permission.EQUIPMENT_MANAGE);
    const eq = await this.prisma.equipment.findUnique({ where: { id } });
    if (!eq) throw notFound("Equipment not found");
    assertCompanyScope(actor, eq.companyId);

    const updated = await this.prisma.equipment.update({
      where: { id },
      data: {
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.trailerLengthFt !== undefined ? { trailerLengthFt: input.trailerLengthFt } : {}),
        ...(input.capacityLbs !== undefined ? { capacityLbs: input.capacityLbs } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    return toEquipmentView(updated);
  }

  async deactivate(actor: AuthenticatedActor, id: string): Promise<EquipmentView> {
    assertPermission(actor, Permission.EQUIPMENT_MANAGE);
    const eq = await this.prisma.equipment.findUnique({ where: { id } });
    if (!eq) throw notFound("Equipment not found");
    assertCompanyScope(actor, eq.companyId);
    const updated = await this.prisma.equipment.update({
      where: { id },
      data: { isActive: false },
    });
    return toEquipmentView(updated);
  }
}
