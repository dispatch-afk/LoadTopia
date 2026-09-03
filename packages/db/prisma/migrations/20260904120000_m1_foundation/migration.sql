-- Milestone 1: Foundation
-- Companies (address + contact + per-company load numbering), memberships
-- (active flag), sessions (active company context), first-class Locations and
-- Equipment, and load routing fields. Adds CHECK constraints and a database
-- trigger that enforces load_events as append-only.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "TransportMode" AS ENUM ('FTL', 'LTL', 'PARTIAL');

ALTER TYPE "EquipmentType" ADD VALUE 'CONESTOGA';
ALTER TYPE "EquipmentType" ADD VALUE 'BOX_TRUCK';
ALTER TYPE "EquipmentType" ADD VALUE 'HOTSHOT';
ALTER TYPE "EquipmentType" ADD VALUE 'OTHER';

ALTER TYPE "LoadEventType" ADD VALUE 'UPDATED';

-- ---------------------------------------------------------------------------
-- companies
-- ---------------------------------------------------------------------------

ALTER TABLE "companies"
  ADD COLUMN "address_line1" TEXT,
  ADD COLUMN "address_line2" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "state" TEXT,
  ADD COLUMN "postal_code" TEXT,
  ADD COLUMN "country" TEXT NOT NULL DEFAULT 'US',
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "email" TEXT,
  ADD COLUMN "load_number_prefix" TEXT,
  ADD COLUMN "load_sequence" INTEGER NOT NULL DEFAULT 0;

-- Backfill a unique, human-readable load-number prefix for any pre-existing
-- company, then enforce NOT NULL + uniqueness. New companies get a name-derived
-- prefix from application code.
WITH numbered AS (
  SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS rn FROM "companies"
)
UPDATE "companies" c
SET "load_number_prefix" = 'LT' || lpad(numbered.rn::text, 5, '0')
FROM numbered
WHERE c."id" = numbered."id" AND c."load_number_prefix" IS NULL;

ALTER TABLE "companies" ALTER COLUMN "load_number_prefix" SET NOT NULL;
CREATE UNIQUE INDEX "companies_load_number_prefix_key" ON "companies"("load_number_prefix");

-- ---------------------------------------------------------------------------
-- company_users (memberships)
-- ---------------------------------------------------------------------------

ALTER TABLE "company_users" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX "company_users_user_id_is_active_idx" ON "company_users"("user_id", "is_active");

-- ---------------------------------------------------------------------------
-- sessions (active company context)
-- ---------------------------------------------------------------------------

ALTER TABLE "sessions" ADD COLUMN "active_company_id" UUID;
CREATE INDEX "sessions_active_company_id_idx" ON "sessions"("active_company_id");
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_company_id_fkey"
  FOREIGN KEY ("active_company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- locations (first-class company location book)
-- ---------------------------------------------------------------------------

ALTER TABLE "locations" DROP CONSTRAINT "locations_company_id_fkey";
DROP INDEX "locations_company_id_idx";
DROP INDEX "locations_region_city_idx";

ALTER TABLE "locations" RENAME COLUMN "region" TO "state";
ALTER TABLE "locations" RENAME COLUMN "label" TO "name";

ALTER TABLE "locations"
  ADD COLUMN "provider_place_id" TEXT,
  ADD COLUMN "geocoded_by" TEXT,
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
  ALTER COLUMN "company_id" SET NOT NULL;

ALTER TABLE "locations" ADD CONSTRAINT "locations_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "locations_company_id_is_active_idx" ON "locations"("company_id", "is_active");
CREATE INDEX "locations_state_city_idx" ON "locations"("state", "city");

-- ---------------------------------------------------------------------------
-- equipment
-- ---------------------------------------------------------------------------

ALTER TABLE "equipment" DROP CONSTRAINT "equipment_company_id_fkey";
DROP INDEX "equipment_company_id_idx";

ALTER TABLE "equipment"
  ADD COLUMN "name" TEXT,
  ADD COLUMN "trailer_length_ft" INTEGER,
  ADD COLUMN "capacity_lbs" INTEGER,
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "equipment" ADD CONSTRAINT "equipment_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "equipment_company_id_is_active_idx" ON "equipment"("company_id", "is_active");

ALTER TABLE "equipment" ADD CONSTRAINT "equipment_trailer_length_ft_check"
  CHECK ("trailer_length_ft" IS NULL OR "trailer_length_ft" > 0);
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_capacity_lbs_check"
  CHECK ("capacity_lbs" IS NULL OR "capacity_lbs" >= 0);

-- ---------------------------------------------------------------------------
-- loads (routing results, transport mode, editor, integrity checks)
-- ---------------------------------------------------------------------------

ALTER TABLE "loads"
  ADD COLUMN "updated_by_user_id" UUID,
  ADD COLUMN "mode" "TransportMode" NOT NULL DEFAULT 'FTL',
  ADD COLUMN "drive_time_minutes" INTEGER,
  ADD COLUMN "routing_provider" TEXT,
  ADD COLUMN "routed_at" TIMESTAMPTZ(6);

ALTER TABLE "loads" ADD CONSTRAINT "loads_updated_by_user_id_fkey"
  FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "loads_shipper_company_id_created_at_idx" ON "loads"("shipper_company_id", "created_at");

ALTER TABLE "loads" ADD CONSTRAINT "loads_weight_lbs_check"
  CHECK ("weight_lbs" IS NULL OR "weight_lbs" >= 0);
ALTER TABLE "loads" ADD CONSTRAINT "loads_pickup_window_check"
  CHECK ("pickup_window_start" IS NULL OR "pickup_window_end" IS NULL OR "pickup_window_end" >= "pickup_window_start");
ALTER TABLE "loads" ADD CONSTRAINT "loads_delivery_window_check"
  CHECK ("delivery_window_start" IS NULL OR "delivery_window_end" IS NULL OR "delivery_window_end" >= "delivery_window_start");
ALTER TABLE "loads" ADD CONSTRAINT "loads_delivery_after_pickup_check"
  CHECK ("pickup_window_start" IS NULL OR "delivery_window_start" IS NULL OR "delivery_window_start" >= "pickup_window_start");
ALTER TABLE "loads" ADD CONSTRAINT "loads_distinct_locations_check"
  CHECK ("origin_location_id" <> "destination_location_id");

-- ---------------------------------------------------------------------------
-- load_events: enforce append-only at the database level
-- ---------------------------------------------------------------------------

-- UPDATE is always rejected (tampering with history). DELETE is rejected too,
-- except within a transaction that has explicitly opted in via
--   SET LOCAL "loadtopia.allow_event_delete" = 'on'
-- which is done ONLY by the "delete a DRAFT load" path so a load that never had
-- real lifecycle history can be removed cleanly (cascade). Every other code
-- path — including a direct loadEvent update/delete — is refused.
CREATE OR REPLACE FUNCTION "loadtopia_reject_mutation"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('loadtopia.allow_event_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'append-only table %: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "load_events_append_only"
  BEFORE UPDATE OR DELETE ON "load_events"
  FOR EACH ROW EXECUTE FUNCTION "loadtopia_reject_mutation"();
