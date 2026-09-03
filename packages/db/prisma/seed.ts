/**
 * Development seed — clearly-labelled MOCK data only. Never run against production.
 *
 * Creates one shipper company (login below) with a location book, equipment and a
 * DRAFT load, plus — for the Milestone 2 marketplace — a POSTED load, an eligible
 * carrier company with its own login and marketplace profile. Idempotent.
 */
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

const prisma = new PrismaClient();

const DEV_EMAIL = "dispatch@loadtopia.local";
const DEV_PASSWORD = "loadtopia-dev-password";
const CARRIER_EMAIL = "driver@loadtopia.local";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed a production database.");
  }

  const passwordHash = await hash(DEV_PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

  const shipper = await prisma.company.upsert({
    where: { type_name: { type: "SHIPPER", name: "[MOCK] Palermo Foods" } },
    update: {},
    create: {
      type: "SHIPPER",
      name: "[MOCK] Palermo Foods",
      loadNumberPrefix: "PALFOO",
      addressLine1: "1 Distribution Way",
      city: "Milwaukee",
      state: "WI",
      postalCode: "53202",
      country: "US",
      phone: "414-555-0100",
      email: "ops@example.test",
    },
  });

  const user = await prisma.user.upsert({
    where: { email: DEV_EMAIL },
    update: { passwordHash },
    create: { email: DEV_EMAIL, passwordHash, firstName: "Dev", lastName: "Dispatcher" },
  });

  await prisma.membership.upsert({
    where: { userId_companyId: { userId: user.id, companyId: shipper.id } },
    update: { isActive: true },
    create: { userId: user.id, companyId: shipper.id, role: "SHIPPER", isPrimary: true },
  });

  const origin = await prisma.location.upsert({
    where: { id: (await findLocation(shipper.id, "[MOCK] Milwaukee DC")) ?? "00000000-0000-0000-0000-000000000000" },
    update: {},
    create: {
      companyId: shipper.id,
      name: "[MOCK] Milwaukee DC",
      addressLine1: "1 Distribution Way",
      city: "Milwaukee",
      state: "WI",
      postalCode: "53202",
      country: "US",
      latitude: 43.0389,
      longitude: -87.9065,
      geocodedBy: "mock",
    },
  });

  const dest = await prisma.location.upsert({
    where: { id: (await findLocation(shipper.id, "[MOCK] Chicago Customer")) ?? "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      companyId: shipper.id,
      name: "[MOCK] Chicago Customer",
      addressLine1: "233 S Wacker Dr",
      city: "Chicago",
      state: "IL",
      postalCode: "60606",
      country: "US",
      latitude: 41.8789,
      longitude: -87.6359,
      geocodedBy: "mock",
    },
  });

  await prisma.equipment.upsert({
    where: { id: (await findEquipment(shipper.id, "[MOCK] Reefer 101")) ?? "00000000-0000-0000-0000-000000000002" },
    update: {},
    create: {
      companyId: shipper.id,
      type: "REEFER",
      name: "[MOCK] Reefer 101",
      trailerLengthFt: 53,
      capacityLbs: 44000,
    },
  });

  const existingLoad = await prisma.load.findFirst({ where: { shipperCompanyId: shipper.id } });
  if (!existingLoad) {
    await prisma.company.update({
      where: { id: shipper.id },
      data: { loadSequence: { increment: 1 } },
    });
    const seq = (await prisma.company.findUniqueOrThrow({ where: { id: shipper.id } })).loadSequence;
    const load = await prisma.load.create({
      data: {
        referenceNumber: `PALFOO-${String(seq).padStart(5, "0")}`,
        status: "DRAFT",
        shipperCompanyId: shipper.id,
        createdByUserId: user.id,
        updatedByUserId: user.id,
        originLocationId: origin.id,
        destinationLocationId: dest.id,
        equipmentType: "REEFER",
        mode: "FTL",
        commodity: "Refrigerated dairy",
        weightLbs: 38000,
        distanceMeters: 148000,
        driveTimeMinutes: 110,
        routingProvider: "mock",
        routedAt: new Date(),
      },
    });
    await prisma.loadEvent.create({
      data: { loadId: load.id, type: "CREATED", toStatus: "DRAFT", actorUserId: user.id },
    });
  }

  // --- Milestone 2: a POSTED load + an eligible carrier ---------------------
  const postedRef = `PALFOO-POST1`;
  let posted = await prisma.load.findFirst({ where: { referenceNumber: postedRef } });
  if (!posted) {
    posted = await prisma.load.create({
      data: {
        referenceNumber: postedRef,
        status: "POSTED",
        shipperCompanyId: shipper.id,
        createdByUserId: user.id,
        updatedByUserId: user.id,
        originLocationId: origin.id,
        destinationLocationId: dest.id,
        equipmentType: "REEFER",
        mode: "FTL",
        commodity: "Refrigerated produce",
        weightLbs: 41000,
        distanceMeters: 148000,
        driveTimeMinutes: 110,
        routingProvider: "mock",
        routedAt: new Date(),
        postedAt: new Date(),
      },
    });
    await prisma.loadEvent.create({
      data: { loadId: posted.id, type: "CREATED", toStatus: "DRAFT", actorUserId: user.id },
    });
    await prisma.loadEvent.create({
      data: {
        loadId: posted.id,
        type: "STATUS_CHANGED",
        fromStatus: "DRAFT",
        toStatus: "POSTED",
        actorUserId: user.id,
      },
    });
  }

  const carrierPasswordHash = await hash(DEV_PASSWORD, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  const carrier = await prisma.company.upsert({
    where: { type_name: { type: "CARRIER", name: "[MOCK] Sunrise Carriers" } },
    update: {},
    create: {
      type: "CARRIER",
      name: "[MOCK] Sunrise Carriers",
      loadNumberPrefix: "SUNCAR",
      mcNumber: "MC100001",
      dotNumber: "DOT2000001",
      addressLine1: "500 Fleet Rd",
      city: "Chicago",
      state: "IL",
      postalCode: "60607",
      country: "US",
    },
  });
  const carrierUser = await prisma.user.upsert({
    where: { email: CARRIER_EMAIL },
    update: { passwordHash: carrierPasswordHash },
    create: {
      email: CARRIER_EMAIL,
      passwordHash: carrierPasswordHash,
      firstName: "Dev",
      lastName: "Driver",
    },
  });
  await prisma.membership.upsert({
    where: { userId_companyId: { userId: carrierUser.id, companyId: carrier.id } },
    update: { isActive: true },
    create: { userId: carrierUser.id, companyId: carrier.id, role: "CARRIER", isPrimary: true },
  });
  await prisma.carrierProfile.upsert({
    where: { companyId: carrier.id },
    update: {},
    create: {
      companyId: carrier.id,
      legalName: "[MOCK] Sunrise Carriers LLC",
      mcNumber: "MC100001",
      dotNumber: "DOT2000001",
      operatingStatus: "ACTIVE",
      // Pre-marked eligible so the marketplace is explorable immediately. In a
      // real flow the carrier runs POST /api/carrier/profile/verify.
      marketplaceEligibility: "ELIGIBLE",
      verificationStatus: "VERIFIED",
      verificationProvider: "mock",
      verificationIsMock: true,
      verificationNote:
        "[MOCK] seed data — NOT FMCSA / DOT / SAFER / insurance / government verification",
      verifiedAt: new Date(),
      equipmentTypes: ["REEFER", "DRY_VAN"],
      serviceAreaStates: ["IL", "WI", "IN"],
    },
  });

  console.log("Seeded [MOCK] dev data. Sign in with:");
  console.table([
    { role: "shipper", email: DEV_EMAIL, password: DEV_PASSWORD, company: shipper.name },
    { role: "carrier", email: CARRIER_EMAIL, password: DEV_PASSWORD, company: carrier.name },
  ]);
}

async function findLocation(companyId: string, name: string): Promise<string | null> {
  const l = await prisma.location.findFirst({ where: { companyId, name } });
  return l?.id ?? null;
}
async function findEquipment(companyId: string, name: string): Promise<string | null> {
  const e = await prisma.equipment.findFirst({ where: { companyId, name } });
  return e?.id ?? null;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
