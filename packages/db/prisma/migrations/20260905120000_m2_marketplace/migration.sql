-- Milestone 2: Marketplace
-- Carrier profiles + verification/eligibility, the offer negotiation model
-- (mutable OfferThread container + IMMUTABLE OfferRound rows + append-only
-- OfferEvent log), pricing snapshots, and the load award/assignment columns.
-- Replaces the unused Phase 0 `load_offers` placeholder.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "CarrierOperatingStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "MarketplaceEligibility" AS ENUM ('PENDING', 'ELIGIBLE', 'INELIGIBLE', 'SUSPENDED');
CREATE TYPE "CarrierVerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFYING', 'VERIFIED', 'FAILED');
CREATE TYPE "OfferThreadStatus" AS ENUM ('ACTIVE', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');
CREATE TYPE "OfferEventType" AS ENUM ('CREATED', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');

-- ---------------------------------------------------------------------------
-- Drop the unused Phase 0 placeholder (zero rows, no application code paths).
-- ---------------------------------------------------------------------------

DROP TABLE "load_offers";
DROP TYPE "OfferStatus";

-- ---------------------------------------------------------------------------
-- loads: marketplace award outcome
-- ---------------------------------------------------------------------------

ALTER TABLE "loads"
  ADD COLUMN "awarded_offer_round_id" UUID,
  ADD COLUMN "awarded_at" TIMESTAMPTZ(6),
  ADD COLUMN "assigned_at" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "loads_awarded_offer_round_id_key" ON "loads"("awarded_offer_round_id");
CREATE INDEX "loads_status_posted_at_idx" ON "loads"("status", "posted_at");
CREATE INDEX "loads_status_equipment_type_posted_at_idx" ON "loads"("status", "equipment_type", "posted_at");

-- ---------------------------------------------------------------------------
-- carrier_profiles
-- ---------------------------------------------------------------------------

CREATE TABLE "carrier_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "legal_name" TEXT NOT NULL,
    "mc_number" TEXT,
    "dot_number" TEXT,
    "operating_status" "CarrierOperatingStatus" NOT NULL DEFAULT 'ACTIVE',
    "marketplace_eligibility" "MarketplaceEligibility" NOT NULL DEFAULT 'PENDING',
    "eligibility_reason" TEXT,
    "verification_status" "CarrierVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verification_provider" TEXT,
    "verification_is_mock" BOOLEAN,
    "verification_ref" TEXT,
    "verification_note" TEXT,
    "verified_at" TIMESTAMPTZ(6),
    "equipment_types" "EquipmentType"[],
    "service_area_states" TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "carrier_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "carrier_profiles_company_id_key" ON "carrier_profiles"("company_id");
CREATE INDEX "carrier_profiles_marketplace_eligibility_idx" ON "carrier_profiles"("marketplace_eligibility");
ALTER TABLE "carrier_profiles" ADD CONSTRAINT "carrier_profiles_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- offer_threads (mutable negotiation container)
-- ---------------------------------------------------------------------------

CREATE TABLE "offer_threads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "load_id" UUID NOT NULL,
    "carrier_company_id" UUID NOT NULL,
    "status" "OfferThreadStatus" NOT NULL DEFAULT 'ACTIVE',
    "round_count" INTEGER NOT NULL DEFAULT 0,
    "current_round_id" UUID,
    "closed_reason" TEXT,
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "offer_threads_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "offer_threads_round_count_check" CHECK ("round_count" >= 0)
);
CREATE UNIQUE INDEX "offer_threads_current_round_id_key" ON "offer_threads"("current_round_id");
CREATE UNIQUE INDEX "offer_threads_load_id_carrier_company_id_key" ON "offer_threads"("load_id", "carrier_company_id");
CREATE INDEX "offer_threads_carrier_company_id_status_idx" ON "offer_threads"("carrier_company_id", "status");
CREATE INDEX "offer_threads_load_id_status_idx" ON "offer_threads"("load_id", "status");
-- Award invariant backstop: at most one ACCEPTED thread per load.
CREATE UNIQUE INDEX "offer_threads_one_accepted_per_load" ON "offer_threads"("load_id") WHERE "status" = 'ACCEPTED';

-- ---------------------------------------------------------------------------
-- offer_rounds (IMMUTABLE)
-- ---------------------------------------------------------------------------

CREATE TABLE "offer_rounds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "thread_id" UUID NOT NULL,
    "round_number" INTEGER NOT NULL,
    "proposed_by_company_id" UUID NOT NULL,
    "proposed_by_user_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "message" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "parent_round_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "offer_rounds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "offer_rounds_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "offer_rounds_round_number_check" CHECK ("round_number" >= 1)
);
CREATE UNIQUE INDEX "offer_rounds_parent_round_id_key" ON "offer_rounds"("parent_round_id");
CREATE UNIQUE INDEX "offer_rounds_thread_id_round_number_key" ON "offer_rounds"("thread_id", "round_number");
CREATE INDEX "offer_rounds_thread_id_created_at_idx" ON "offer_rounds"("thread_id", "created_at");

-- ---------------------------------------------------------------------------
-- offer_events (IMMUTABLE append-only)
-- ---------------------------------------------------------------------------

CREATE TABLE "offer_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "thread_id" UUID NOT NULL,
    "round_id" UUID,
    "type" "OfferEventType" NOT NULL,
    "actor_user_id" UUID,
    "actor_company_id" UUID,
    "data" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "offer_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "offer_events_thread_id_created_at_idx" ON "offer_events"("thread_id", "created_at");
CREATE INDEX "offer_events_type_created_at_idx" ON "offer_events"("type", "created_at");

-- ---------------------------------------------------------------------------
-- pricing_snapshots (IMMUTABLE)
-- ---------------------------------------------------------------------------

CREATE TABLE "pricing_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "load_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "is_mock" BOOLEAN NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "low_rate" DECIMAL(14,2) NOT NULL,
    "mid_rate" DECIMAL(14,2) NOT NULL,
    "high_rate" DECIMAL(14,2) NOT NULL,
    "rate_per_mile" DECIMAL(10,4),
    "confidence" TEXT NOT NULL,
    "disclaimer" TEXT,
    "distance_meters" INTEGER,
    "equipment_type" "EquipmentType" NOT NULL,
    "origin_state" TEXT NOT NULL,
    "destination_state" TEXT NOT NULL,
    "inputs_hash" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pricing_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pricing_snapshots_band_check"
      CHECK ("low_rate" >= 0 AND "low_rate" <= "mid_rate" AND "mid_rate" <= "high_rate")
);
CREATE INDEX "pricing_snapshots_load_id_created_at_idx" ON "pricing_snapshots"("load_id", "created_at");

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------

ALTER TABLE "loads" ADD CONSTRAINT "loads_awarded_offer_round_id_fkey"
  FOREIGN KEY ("awarded_offer_round_id") REFERENCES "offer_rounds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "offer_threads" ADD CONSTRAINT "offer_threads_load_id_fkey"
  FOREIGN KEY ("load_id") REFERENCES "loads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "offer_threads" ADD CONSTRAINT "offer_threads_carrier_company_id_fkey"
  FOREIGN KEY ("carrier_company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "offer_threads" ADD CONSTRAINT "offer_threads_current_round_id_fkey"
  FOREIGN KEY ("current_round_id") REFERENCES "offer_rounds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "offer_rounds" ADD CONSTRAINT "offer_rounds_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "offer_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "offer_rounds" ADD CONSTRAINT "offer_rounds_proposed_by_company_id_fkey"
  FOREIGN KEY ("proposed_by_company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offer_rounds" ADD CONSTRAINT "offer_rounds_proposed_by_user_id_fkey"
  FOREIGN KEY ("proposed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offer_rounds" ADD CONSTRAINT "offer_rounds_parent_round_id_fkey"
  FOREIGN KEY ("parent_round_id") REFERENCES "offer_rounds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "offer_events" ADD CONSTRAINT "offer_events_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "offer_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "offer_events" ADD CONSTRAINT "offer_events_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "offer_events" ADD CONSTRAINT "offer_events_actor_company_id_fkey"
  FOREIGN KEY ("actor_company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pricing_snapshots" ADD CONSTRAINT "pricing_snapshots_load_id_fkey"
  FOREIGN KEY ("load_id") REFERENCES "loads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pricing_snapshots" ADD CONSTRAINT "pricing_snapshots_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Database-level immutability for commercially significant history.
-- Reuses loadtopia_reject_mutation() from the m1_foundation migration:
--   UPDATE is always rejected; DELETE is rejected unless a transaction opted in
--   via SET LOCAL "loadtopia.allow_event_delete" = 'on' (only the delete-a-DRAFT
--   -load path does this, which can legitimately cascade a load's own draft-era
--   pricing snapshot). Offer rounds/events only exist on POSTED+ loads, which
--   are never hard-deleted, so for them DELETE is effectively impossible too.
-- ---------------------------------------------------------------------------

CREATE TRIGGER "offer_rounds_append_only"
  BEFORE UPDATE OR DELETE ON "offer_rounds"
  FOR EACH ROW EXECUTE FUNCTION "loadtopia_reject_mutation"();

CREATE TRIGGER "offer_events_append_only"
  BEFORE UPDATE OR DELETE ON "offer_events"
  FOR EACH ROW EXECUTE FUNCTION "loadtopia_reject_mutation"();

CREATE TRIGGER "pricing_snapshots_append_only"
  BEFORE UPDATE OR DELETE ON "pricing_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "loadtopia_reject_mutation"();
