-- CreateEnum
CREATE TYPE "LoadAudienceStrategyType" AS ENUM ('MARKETPLACE', 'NETWORK_FIRST', 'SELECTED_FIRST');

-- CreateEnum
CREATE TYPE "LoadAudienceStage" AS ENUM ('SELECTED', 'NETWORK', 'MARKETPLACE');

-- CreateEnum
CREATE TYPE "LoadReleaseStatus" AS ENUM ('PENDING', 'RELEASED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LoadEventType" ADD VALUE 'LOAD_POSTED_TO_MARKETPLACE';
ALTER TYPE "LoadEventType" ADD VALUE 'LOAD_POSTED_TO_NETWORK';
ALTER TYPE "LoadEventType" ADD VALUE 'LOAD_POSTED_TO_SELECTED_CARRIERS';
ALTER TYPE "LoadEventType" ADD VALUE 'MARKETPLACE_RELEASE_SCHEDULED';
ALTER TYPE "LoadEventType" ADD VALUE 'NETWORK_RELEASE_SCHEDULED';
ALTER TYPE "LoadEventType" ADD VALUE 'LOAD_RELEASED_TO_NETWORK';
ALTER TYPE "LoadEventType" ADD VALUE 'LOAD_RELEASED_TO_MARKETPLACE';
ALTER TYPE "LoadEventType" ADD VALUE 'RELEASE_RESCHEDULED';
ALTER TYPE "LoadEventType" ADD VALUE 'RELEASE_CANCELLED';

-- CreateTable
CREATE TABLE "load_audience_strategies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "load_id" UUID NOT NULL,
    "strategy" "LoadAudienceStrategyType" NOT NULL,
    "current_stage" "LoadAudienceStage" NOT NULL,
    "auto_release_disabled" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "load_audience_strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "load_audience_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "load_id" UUID NOT NULL,
    "strategy_id" UUID NOT NULL,
    "stage" "LoadAudienceStage" NOT NULL,
    "carrier_company_id" UUID NOT NULL,
    "source_group_id" UUID,
    "source_group_name" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "load_audience_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "load_audience_releases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "load_id" UUID NOT NULL,
    "strategy_id" UUID NOT NULL,
    "from_stage" "LoadAudienceStage" NOT NULL,
    "to_stage" "LoadAudienceStage" NOT NULL,
    "status" "LoadReleaseStatus" NOT NULL DEFAULT 'PENDING',
    "scheduled_at" TIMESTAMPTZ(6) NOT NULL,
    "executed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "load_audience_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "load_audience_strategies_load_id_key" ON "load_audience_strategies"("load_id");

-- CreateIndex
CREATE INDEX "load_audience_strategies_current_stage_idx" ON "load_audience_strategies"("current_stage");

-- CreateIndex
CREATE INDEX "load_audience_members_carrier_company_id_idx" ON "load_audience_members"("carrier_company_id");

-- CreateIndex
CREATE UNIQUE INDEX "load_audience_members_load_id_stage_carrier_company_id_key" ON "load_audience_members"("load_id", "stage", "carrier_company_id");

-- CreateIndex
CREATE INDEX "load_audience_releases_status_scheduled_at_idx" ON "load_audience_releases"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "load_audience_releases_load_id_idx" ON "load_audience_releases"("load_id");

-- AddForeignKey
ALTER TABLE "load_audience_strategies" ADD CONSTRAINT "load_audience_strategies_load_id_fkey" FOREIGN KEY ("load_id") REFERENCES "loads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_audience_strategies" ADD CONSTRAINT "load_audience_strategies_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_audience_members" ADD CONSTRAINT "load_audience_members_load_id_fkey" FOREIGN KEY ("load_id") REFERENCES "loads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_audience_members" ADD CONSTRAINT "load_audience_members_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "load_audience_strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_audience_releases" ADD CONSTRAINT "load_audience_releases_load_id_fkey" FOREIGN KEY ("load_id") REFERENCES "loads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_audience_releases" ADD CONSTRAINT "load_audience_releases_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "load_audience_strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_audience_releases" ADD CONSTRAINT "load_audience_releases_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
