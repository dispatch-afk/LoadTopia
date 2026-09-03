/**
 * Development seed — clearly-labelled MOCK data only.
 *
 * Creates two demo companies (one shipper, one carrier) and an admin user so the
 * auth foundation can be exercised locally. It creates NO loads, NO offers, and
 * NO market rates — those belong to later milestones. Safe to re-run (idempotent
 * upserts). Never run against production.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Placeholder Argon2id hash of the string "ChangeMe-dev-000" — dev only.
// Regenerate with: node -e "require('@node-rs/argon2').hash('...').then(console.log)"
const DEV_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c2VlZHNlZWRzZWVkc2VlZA$3s5Yd0m3o0m9m0Q1u8m8m6m0m0m0m0m0m0m0m0m0m0";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed a production database.");
  }

  const shipper = await prisma.company.upsert({
    where: { type_name: { type: "SHIPPER", name: "[MOCK] Palermo Foods" } },
    update: {},
    create: { type: "SHIPPER", name: "[MOCK] Palermo Foods" },
  });

  const carrier = await prisma.company.upsert({
    where: { type_name: { type: "CARRIER", name: "[MOCK] Blue Ridge Carriers" } },
    update: {},
    create: { type: "CARRIER", name: "[MOCK] Blue Ridge Carriers", mcNumber: "MC-000000" },
  });

  const admin = await prisma.user.upsert({
    where: { email: "admin@loadtopia.local" },
    update: {},
    create: {
      email: "admin@loadtopia.local",
      passwordHash: DEV_PASSWORD_HASH,
      firstName: "Dev",
      lastName: "Admin",
    },
  });

  console.log("Seeded MOCK data:");
  console.table([
    { entity: "company (shipper)", id: shipper.id, name: shipper.name },
    { entity: "company (carrier)", id: carrier.id, name: carrier.name },
    { entity: "user (admin)", id: admin.id, email: admin.email },
  ]);
  console.log(
    "\nNote: the admin password hash is a non-functional placeholder. Register a\n" +
      "real user via POST /api/auth/register, or replace the hash, before signing in.",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
