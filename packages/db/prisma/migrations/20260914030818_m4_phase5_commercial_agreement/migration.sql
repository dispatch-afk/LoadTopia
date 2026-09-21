-- CreateEnum
CREATE TYPE "LoadCommercialMode" AS ENUM ('PUBLISH_RATE', 'REQUEST_OFFERS');

-- CreateEnum
CREATE TYPE "OfferThreadOriginType" AS ENUM ('CARRIER_OFFER', 'POSTED_RATE_BOOKING');

-- AlterTable
ALTER TABLE "loads" ADD COLUMN     "commercial_mode" "LoadCommercialMode" NOT NULL DEFAULT 'REQUEST_OFFERS',
ADD COLUMN     "posted_rate" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "offer_threads" ADD COLUMN     "origin_type" "OfferThreadOriginType" NOT NULL DEFAULT 'CARRIER_OFFER';
