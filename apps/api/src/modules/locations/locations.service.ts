import type { Prisma, PrismaClient } from "@loadtopia/db";
import { assertCompanyScope, assertPermission, Permission } from "@loadtopia/domain";
import type { GeocodingProvider } from "@loadtopia/providers";
import type {
  AuthenticatedActor,
  CreateLocationInput,
  LocationView,
  Paginated,
  Pagination,
  UpdateLocationInput,
} from "@loadtopia/shared";
import { conflict, notFound } from "../../lib/errors";
import { paginate, toSkipTake } from "../../lib/pagination";

type LocationRow = Prisma.LocationGetPayload<Record<string, never>>;

export function toLocationView(l: LocationRow): LocationView {
  return {
    id: l.id,
    companyId: l.companyId,
    name: l.name,
    addressLine1: l.addressLine1,
    addressLine2: l.addressLine2,
    city: l.city,
    state: l.state,
    postalCode: l.postalCode,
    country: l.country,
    latitude: l.latitude?.toString() ?? null,
    longitude: l.longitude?.toString() ?? null,
    isGeocoded: l.latitude !== null && l.longitude !== null,
    geocodedBy: l.geocodedBy,
    isActive: l.isActive,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

export class LocationsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly geocoder: GeocodingProvider,
    private readonly log: { warn: (obj: unknown, msg: string) => void },
  ) {}

  private async geocode(addr: {
    addressLine1: string;
    addressLine2?: string | null;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  }): Promise<{ latitude: number | null; longitude: number | null; placeId: string | null; by: string | null }> {
    try {
      const result = await this.geocoder.geocode({
        addressLine1: addr.addressLine1,
        addressLine2: addr.addressLine2 ?? undefined,
        city: addr.city,
        region: addr.state,
        postalCode: addr.postalCode,
        country: addr.country,
      });
      return {
        latitude: result.point.latitude,
        longitude: result.point.longitude,
        placeId: (result.metadata?.placeId as string | undefined) ?? null,
        by: result.provider,
      };
    } catch (err) {
      this.log.warn({ err }, "geocoding failed; location stored without coordinates");
      return { latitude: null, longitude: null, placeId: null, by: null };
    }
  }

  async create(
    actor: AuthenticatedActor,
    companyId: string,
    input: CreateLocationInput,
  ): Promise<LocationView> {
    assertPermission(actor, Permission.LOCATION_MANAGE);
    const geo = await this.geocode(input);
    const location = await this.prisma.location.create({
      data: {
        companyId,
        name: input.name ?? null,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2 ?? null,
        city: input.city,
        state: input.state,
        postalCode: input.postalCode,
        country: input.country,
        latitude: geo.latitude,
        longitude: geo.longitude,
        providerPlaceId: geo.placeId,
        geocodedBy: geo.by,
      },
    });
    return toLocationView(location);
  }

  async list(
    actor: AuthenticatedActor,
    companyId: string,
    p: Pagination & { includeInactive?: boolean },
  ): Promise<Paginated<LocationView>> {
    assertPermission(actor, Permission.LOCATION_READ);
    const where: Prisma.LocationWhereInput = {
      companyId,
      ...(p.includeInactive ? {} : { isActive: true }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.location.findMany({
        where,
        orderBy: [{ isActive: "desc" }, { name: "asc" }, { createdAt: "desc" }],
        ...toSkipTake(p),
      }),
      this.prisma.location.count({ where }),
    ]);
    return paginate(rows.map(toLocationView), total, p);
  }

  async getById(actor: AuthenticatedActor, id: string): Promise<LocationView> {
    assertPermission(actor, Permission.LOCATION_READ);
    const location = await this.prisma.location.findUnique({ where: { id } });
    if (!location) throw notFound("Location not found");
    assertCompanyScope(actor, location.companyId);
    return toLocationView(location);
  }

  async update(
    actor: AuthenticatedActor,
    id: string,
    input: UpdateLocationInput,
  ): Promise<LocationView> {
    assertPermission(actor, Permission.LOCATION_MANAGE);
    const location = await this.prisma.location.findUnique({ where: { id } });
    if (!location) throw notFound("Location not found");
    assertCompanyScope(actor, location.companyId);

    const addressChanged =
      input.addressLine1 !== undefined ||
      input.addressLine2 !== undefined ||
      input.city !== undefined ||
      input.state !== undefined ||
      input.postalCode !== undefined ||
      input.country !== undefined;

    const data: Prisma.LocationUpdateInput = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.addressLine1 !== undefined ? { addressLine1: input.addressLine1 } : {}),
      ...(input.addressLine2 !== undefined ? { addressLine2: input.addressLine2 } : {}),
      ...(input.city !== undefined ? { city: input.city } : {}),
      ...(input.state !== undefined ? { state: input.state } : {}),
      ...(input.postalCode !== undefined ? { postalCode: input.postalCode } : {}),
      ...(input.country !== undefined ? { country: input.country } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    };

    if (addressChanged) {
      const geo = await this.geocode({
        addressLine1: input.addressLine1 ?? location.addressLine1,
        addressLine2: input.addressLine2 ?? location.addressLine2,
        city: input.city ?? location.city,
        state: input.state ?? location.state,
        postalCode: input.postalCode ?? location.postalCode,
        country: input.country ?? location.country,
      });
      data.latitude = geo.latitude;
      data.longitude = geo.longitude;
      data.providerPlaceId = geo.placeId;
      data.geocodedBy = geo.by;
    }

    const updated = await this.prisma.location.update({ where: { id }, data });
    return toLocationView(updated);
  }

  /** Soft delete: deactivate. A location referenced by loads keeps its record. */
  async deactivate(actor: AuthenticatedActor, id: string): Promise<LocationView> {
    assertPermission(actor, Permission.LOCATION_MANAGE);
    const location = await this.prisma.location.findUnique({ where: { id } });
    if (!location) throw notFound("Location not found");
    assertCompanyScope(actor, location.companyId);
    if (!location.isActive) return toLocationView(location);

    // Block removing a location still referenced by a non-terminal load.
    const inUse = await this.prisma.load.count({
      where: {
        OR: [{ originLocationId: id }, { destinationLocationId: id }],
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
    });
    if (inUse > 0) {
      throw conflict("This location is used by an active load and cannot be removed");
    }

    const updated = await this.prisma.location.update({
      where: { id },
      data: { isActive: false },
    });
    return toLocationView(updated);
  }

  /** Resolve N locations that must all belong to the company (load create/update). */
  async requireOwned(companyId: string, ids: string[]): Promise<Map<string, LocationRow>> {
    const rows = await this.prisma.location.findMany({
      where: { id: { in: ids }, companyId },
    });
    const map = new Map(rows.map((r) => [r.id, r]));
    for (const id of ids) {
      if (!map.has(id)) throw notFound("Location not found");
    }
    return map;
  }
}
