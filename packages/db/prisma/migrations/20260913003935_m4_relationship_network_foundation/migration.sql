-- Milestone 4 Phase 2: relationship network + facility scope foundation.
--
-- Hand-reviewed and hand-edited on top of the Prisma-generated diff. Three
-- things Prisma's schema DSL cannot express, added below:
--   1. CHECK (company_a_id < company_b_id) on company_connections — the
--      database-level backstop for the canonical-pair strategy (mirrors
--      canonicalizeCompanyPair() in @loadtopia/domain: both sides must
--      independently compute the same order for the same pair).
--   2. CHECK (requester_company_id IN (company_a_id, company_b_id)) — the
--      requester must always be one of the two companies in the pair.
--   3. A PARTIAL UNIQUE INDEX allowing at most one CURRENTLY-in-force
--      company_block row per direction, while permitting unlimited
--      historical (INACTIVE) rows for the same direction — the exact same
--      pattern already used for offer_threads_one_accepted_per_load.
--   4. An append-only trigger on company_connection_events, reusing the
--      existing loadtopia_reject_mutation() function from m1_foundation —
--      matching load_events / offer_events / document_reviews.
--
-- Purely additive: five new tables, zero existing tables altered, zero
-- existing data touched, zero destructive operations.

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "ConnectionEventType" AS ENUM ('REQUESTED', 'ACCEPTED', 'DECLINED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "CarrierPreferenceType" AS ENUM ('PREFER', 'DO_NOT_PREFER');

-- CreateEnum
CREATE TYPE "CompanyBlockStatus" AS ENUM ('PENDING_ON_COMPLETION', 'ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "carrier_follows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "carrier_company_id" UUID NOT NULL,
    "shipper_company_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carrier_follows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_a_id" UUID NOT NULL,
    "company_b_id" UUID NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "requester_company_id" UUID NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL,
    "responded_by_user_id" UUID,
    "responded_at" TIMESTAMPTZ(6),
    "disconnected_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "company_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_connection_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "connection_id" UUID NOT NULL,
    "type" "ConnectionEventType" NOT NULL,
    "actor_user_id" UUID,
    "actor_company_id" UUID,
    "data" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_connection_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carrier_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipper_company_id" UUID NOT NULL,
    "carrier_company_id" UUID NOT NULL,
    "preference" "CarrierPreferenceType" NOT NULL,
    "set_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "carrier_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_blocks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "blocking_company_id" UUID NOT NULL,
    "blocked_company_id" UUID NOT NULL,
    "status" "CompanyBlockStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_at" TIMESTAMPTZ(6),
    "removed_by_user_id" UUID,
    "removed_at" TIMESTAMPTZ(6),

    CONSTRAINT "company_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carrier_groups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipper_company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "carrier_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carrier_group_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "group_id" UUID NOT NULL,
    "carrier_company_id" UUID NOT NULL,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carrier_group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_facility_scope" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "membership_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_facility_scope_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "carrier_follows_shipper_company_id_idx" ON "carrier_follows"("shipper_company_id");

-- CreateIndex
CREATE UNIQUE INDEX "carrier_follows_carrier_company_id_shipper_company_id_key" ON "carrier_follows"("carrier_company_id", "shipper_company_id");

-- CreateIndex
CREATE INDEX "company_connections_company_b_id_idx" ON "company_connections"("company_b_id");

-- CreateIndex
CREATE INDEX "company_connections_requester_company_id_idx" ON "company_connections"("requester_company_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_connections_company_a_id_company_b_id_key" ON "company_connections"("company_a_id", "company_b_id");

-- CreateIndex
CREATE INDEX "company_connection_events_connection_id_created_at_idx" ON "company_connection_events"("connection_id", "created_at");

-- CreateIndex
CREATE INDEX "carrier_preferences_carrier_company_id_idx" ON "carrier_preferences"("carrier_company_id");

-- CreateIndex
CREATE UNIQUE INDEX "carrier_preferences_shipper_company_id_carrier_company_id_key" ON "carrier_preferences"("shipper_company_id", "carrier_company_id");

-- CreateIndex
CREATE INDEX "company_blocks_blocking_company_id_status_idx" ON "company_blocks"("blocking_company_id", "status");

-- CreateIndex
CREATE INDEX "company_blocks_blocked_company_id_status_idx" ON "company_blocks"("blocked_company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "carrier_groups_shipper_company_id_normalized_name_key" ON "carrier_groups"("shipper_company_id", "normalized_name");

-- CreateIndex
CREATE INDEX "carrier_group_members_carrier_company_id_idx" ON "carrier_group_members"("carrier_company_id");

-- CreateIndex
CREATE UNIQUE INDEX "carrier_group_members_group_id_carrier_company_id_key" ON "carrier_group_members"("group_id", "carrier_company_id");

-- CreateIndex
CREATE INDEX "membership_facility_scope_location_id_idx" ON "membership_facility_scope"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "membership_facility_scope_membership_id_location_id_key" ON "membership_facility_scope"("membership_id", "location_id");

-- AddForeignKey
ALTER TABLE "carrier_follows" ADD CONSTRAINT "carrier_follows_carrier_company_id_fkey" FOREIGN KEY ("carrier_company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carrier_follows" ADD CONSTRAINT "carrier_follows_shipper_company_id_fkey" FOREIGN KEY ("shipper_company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_connections" ADD CONSTRAINT "company_connections_company_a_id_fkey" FOREIGN KEY ("company_a_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_connections" ADD CONSTRAINT "company_connections_company_b_id_fkey" FOREIGN KEY ("company_b_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_connections" ADD CONSTRAINT "company_connections_requester_company_id_fkey" FOREIGN KEY ("requester_company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_connections" ADD CONSTRAINT "company_connections_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_connections" ADD CONSTRAINT "company_connections_responded_by_user_id_fkey" FOREIGN KEY ("responded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_connection_events" ADD CONSTRAINT "company_connection_events_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "company_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_connection_events" ADD CONSTRAINT "company_connection_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_connection_events" ADD CONSTRAINT "company_connection_events_actor_company_id_fkey" FOREIGN KEY ("actor_company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carrier_preferences" ADD CONSTRAINT "carrier_preferences_shipper_company_id_fkey" FOREIGN KEY ("shipper_company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carrier_preferences" ADD CONSTRAINT "carrier_preferences_carrier_company_id_fkey" FOREIGN KEY ("carrier_company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carrier_preferences" ADD CONSTRAINT "carrier_preferences_set_by_user_id_fkey" FOREIGN KEY ("set_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_blocks" ADD CONSTRAINT "company_blocks_blocking_company_id_fkey" FOREIGN KEY ("blocking_company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_blocks" ADD CONSTRAINT "company_blocks_blocked_company_id_fkey" FOREIGN KEY ("blocked_company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_blocks" ADD CONSTRAINT "company_blocks_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_blocks" ADD CONSTRAINT "company_blocks_removed_by_user_id_fkey" FOREIGN KEY ("removed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carrier_groups" ADD CONSTRAINT "carrier_groups_shipper_company_id_fkey" FOREIGN KEY ("shipper_company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carrier_group_members" ADD CONSTRAINT "carrier_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "carrier_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carrier_group_members" ADD CONSTRAINT "carrier_group_members_carrier_company_id_fkey" FOREIGN KEY ("carrier_company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_facility_scope" ADD CONSTRAINT "membership_facility_scope_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "company_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_facility_scope" ADD CONSTRAINT "membership_facility_scope_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-added: canonical-pair CHECK constraints (company_connections)
-- ---------------------------------------------------------------------------

ALTER TABLE "company_connections" ADD CONSTRAINT "company_connections_canonical_order_check"
  CHECK ("company_a_id" < "company_b_id");

ALTER TABLE "company_connections" ADD CONSTRAINT "company_connections_requester_in_pair_check"
  CHECK ("requester_company_id" = "company_a_id" OR "requester_company_id" = "company_b_id");

-- ---------------------------------------------------------------------------
-- Hand-added: at most one CURRENTLY-in-force block per direction.
-- Mirrors offer_threads_one_accepted_per_load: a partial unique index, not a
-- plain UNIQUE, so unblocking (-> INACTIVE) and a later re-block create a NEW
-- row rather than requiring the old one to be deleted or overwritten.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX "company_blocks_one_in_force_per_direction"
  ON "company_blocks"("blocking_company_id", "blocked_company_id")
  WHERE "status" IN ('ACTIVE', 'PENDING_ON_COMPLETION');

-- ---------------------------------------------------------------------------
-- Hand-added: company_connection_events is append-only at the database
-- level, reusing the existing loadtopia_reject_mutation() function
-- (m1_foundation). INSERT only; UPDATE/DELETE rejected by PostgreSQL — the
-- immutable history behind CompanyConnection.status, exactly like
-- load_events / offer_events / document_reviews.
-- ---------------------------------------------------------------------------

CREATE TRIGGER "company_connection_events_append_only"
  BEFORE UPDATE OR DELETE ON "company_connection_events"
  FOR EACH ROW EXECUTE FUNCTION "loadtopia_reject_mutation"();
