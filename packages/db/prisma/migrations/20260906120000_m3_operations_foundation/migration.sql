-- Milestone 3: Operations (foundation slice)
-- Post-award shipment lifecycle: manual check-ins, operational documents
-- (BOL/POD/OTHER) with explicit shipper POD review, and a LoadTopia-generated
-- immutable Rate Confirmation commercial snapshot.
--
-- Purely additive: three nullable columns on loads (no historical row can
-- have ever reached PICKED_UP/DELIVERED/COMPLETED before this migration,
-- since EXPOSED_LOAD_STATUSES never allowed it), one nullable column on
-- load_events, and four new tables. Zero backfill. Zero fabricated history.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

ALTER TYPE "LoadEventType" ADD VALUE 'CHECK_IN_ADDED';
ALTER TYPE "LoadEventType" ADD VALUE 'DOCUMENT_UPLOADED';
ALTER TYPE "LoadEventType" ADD VALUE 'DOCUMENT_REVIEWED';
ALTER TYPE "LoadEventType" ADD VALUE 'DOCUMENT_REMOVED';
ALTER TYPE "LoadEventType" ADD VALUE 'EXCEPTION_REPORTED';

CREATE TYPE "DocumentType" AS ENUM ('BOL', 'POD', 'OTHER');
CREATE TYPE "DocumentReviewStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');
CREATE TYPE "DocumentReviewDecision" AS ENUM ('APPROVED', 'REJECTED');
CREATE TYPE "RateConfirmationStatus" AS ENUM ('PENDING', 'GENERATED', 'FAILED');

-- ---------------------------------------------------------------------------
-- loads: operational lifecycle timestamps
-- ---------------------------------------------------------------------------

ALTER TABLE "loads"
  ADD COLUMN "picked_up_at" TIMESTAMPTZ(6),
  ADD COLUMN "delivered_at" TIMESTAMPTZ(6),
  ADD COLUMN "completed_at" TIMESTAMPTZ(6);

-- ---------------------------------------------------------------------------
-- load_events: actor company attribution (Milestone 3 has both shipper- and
-- carrier-authored events on the same timeline; null for every event that
-- predates this column, exactly like the existing nullable actor_user_id)
-- ---------------------------------------------------------------------------

ALTER TABLE "load_events" ADD COLUMN "actor_company_id" UUID;
ALTER TABLE "load_events" ADD CONSTRAINT "load_events_actor_company_id_fkey"
  FOREIGN KEY ("actor_company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- load_check_ins (manual carrier location/status check-ins — tracking Level B)
-- ---------------------------------------------------------------------------

CREATE TABLE "load_check_ins" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "load_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "note" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "recorded_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "load_check_ins_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "load_check_ins_load_id_recorded_at_idx" ON "load_check_ins"("load_id", "recorded_at");

ALTER TABLE "load_check_ins" ADD CONSTRAINT "load_check_ins_load_id_fkey"
  FOREIGN KEY ("load_id") REFERENCES "loads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "load_check_ins" ADD CONSTRAINT "load_check_ins_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- load_documents (operational, user-submitted evidence — BOL / POD / OTHER)
--
-- Two-stage upload: confirmed_at is null until the client confirms the
-- underlying object upload succeeded. A row with confirmed_at IS NULL is
-- invisible to every list/read endpoint and never reviewable — see
-- docs/MILESTONE-3.md. review_status is set to PENDING_REVIEW only at
-- confirm time for doc_type = POD, never at request time.
-- ---------------------------------------------------------------------------

CREATE TABLE "load_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "load_id" UUID NOT NULL,
    "doc_type" "DocumentType" NOT NULL,
    "uploaded_by_user_id" UUID NOT NULL,
    "uploaded_by_company_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER,
    "original_filename" TEXT,
    "confirmed_at" TIMESTAMPTZ(6),
    "review_status" "DocumentReviewStatus",
    "replaces_document_id" UUID,
    "removed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "load_documents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "load_documents_load_id_doc_type_idx" ON "load_documents"("load_id", "doc_type");
-- What assertCompletionReadiness() queries: doc_type='POD' AND
-- review_status='APPROVED' AND removed_at IS NULL.
CREATE INDEX "load_documents_load_id_doc_type_review_status_idx" ON "load_documents"("load_id", "doc_type", "review_status");

ALTER TABLE "load_documents" ADD CONSTRAINT "load_documents_load_id_fkey"
  FOREIGN KEY ("load_id") REFERENCES "loads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "load_documents" ADD CONSTRAINT "load_documents_uploaded_by_user_id_fkey"
  FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "load_documents" ADD CONSTRAINT "load_documents_uploaded_by_company_id_fkey"
  FOREIGN KEY ("uploaded_by_company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "load_documents" ADD CONSTRAINT "load_documents_replaces_document_id_fkey"
  FOREIGN KEY ("replaces_document_id") REFERENCES "load_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- document_reviews (IMMUTABLE) — the audit trail behind
-- load_documents.review_status, structurally identical in role to
-- offer_events behind offer_threads.status. document_id is UNIQUE: a
-- specific document receives at most one terminal review decision,
-- guaranteed by the database — the same "DB partial unique guarantees ≤ 1"
-- precedent already used for offer_threads' one-accepted-per-load index.
-- ---------------------------------------------------------------------------

CREATE TABLE "document_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" UUID NOT NULL,
    "reviewer_user_id" UUID NOT NULL,
    "reviewer_company_id" UUID NOT NULL,
    "decision" "DocumentReviewDecision" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_reviews_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "document_reviews_document_id_key" ON "document_reviews"("document_id");
CREATE INDEX "document_reviews_document_id_created_at_idx" ON "document_reviews"("document_id", "created_at");

ALTER TABLE "document_reviews" ADD CONSTRAINT "document_reviews_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "load_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_reviews" ADD CONSTRAINT "document_reviews_reviewer_user_id_fkey"
  FOREIGN KEY ("reviewer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_reviews" ADD CONSTRAINT "document_reviews_reviewer_company_id_fkey"
  FOREIGN KEY ("reviewer_company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- rate_confirmations (IMMUTABLE commercial snapshot) — generated entirely by
-- LoadTopia, persisted inside OffersService.accept()'s existing award
-- transaction. The commercial agreement is created by offer acceptance, NOT
-- by carrier assignment — assign() never touches this table. At most one row
-- per load under the currently-reachable lifecycle (see the dormant
-- AWARDED -> POSTED transition note in docs/MILESTONE-3.md).
-- ---------------------------------------------------------------------------

CREATE TABLE "rate_confirmations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "load_id" UUID NOT NULL,
    "reference_number" TEXT NOT NULL,
    "status" "RateConfirmationStatus" NOT NULL DEFAULT 'PENDING',
    "storage_key" TEXT,
    "generated_at" TIMESTAMPTZ(6),

    "shipper_company_id" UUID NOT NULL,
    "shipper_company_name" TEXT NOT NULL,
    "shipper_mc_number" TEXT,
    "shipper_dot_number" TEXT,

    "carrier_company_id" UUID NOT NULL,
    "carrier_company_name" TEXT NOT NULL,
    "carrier_legal_name" TEXT,
    "carrier_mc_number" TEXT,
    "carrier_dot_number" TEXT,

    "origin_address_line1" TEXT NOT NULL,
    "origin_address_line2" TEXT,
    "origin_city" TEXT NOT NULL,
    "origin_state" TEXT NOT NULL,
    "origin_postal_code" TEXT NOT NULL,
    "origin_country" TEXT NOT NULL,

    "destination_address_line1" TEXT NOT NULL,
    "destination_address_line2" TEXT,
    "destination_city" TEXT NOT NULL,
    "destination_state" TEXT NOT NULL,
    "destination_postal_code" TEXT NOT NULL,
    "destination_country" TEXT NOT NULL,

    "pickup_window_start" TIMESTAMPTZ(6),
    "pickup_window_end" TIMESTAMPTZ(6),
    "delivery_window_start" TIMESTAMPTZ(6),
    "delivery_window_end" TIMESTAMPTZ(6),

    "equipment_type" "EquipmentType" NOT NULL,
    "commodity" TEXT,
    "weight_lbs" INTEGER,

    "agreed_rate" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "distance_meters" INTEGER,

    "awarded_offer_round_id" UUID NOT NULL,
    "awarded_at" TIMESTAMPTZ(6) NOT NULL,

    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rate_confirmations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rate_confirmations_agreed_rate_check" CHECK ("agreed_rate" > 0)
);
CREATE UNIQUE INDEX "rate_confirmations_load_id_key" ON "rate_confirmations"("load_id");
CREATE UNIQUE INDEX "rate_confirmations_reference_number_key" ON "rate_confirmations"("reference_number");
CREATE UNIQUE INDEX "rate_confirmations_awarded_offer_round_id_key" ON "rate_confirmations"("awarded_offer_round_id");

ALTER TABLE "rate_confirmations" ADD CONSTRAINT "rate_confirmations_load_id_fkey"
  FOREIGN KEY ("load_id") REFERENCES "loads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rate_confirmations" ADD CONSTRAINT "rate_confirmations_shipper_company_id_fkey"
  FOREIGN KEY ("shipper_company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rate_confirmations" ADD CONSTRAINT "rate_confirmations_carrier_company_id_fkey"
  FOREIGN KEY ("carrier_company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rate_confirmations" ADD CONSTRAINT "rate_confirmations_awarded_offer_round_id_fkey"
  FOREIGN KEY ("awarded_offer_round_id") REFERENCES "offer_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Database-level immutability
-- ---------------------------------------------------------------------------

-- document_reviews: reuses loadtopia_reject_mutation() from m1_foundation —
-- UPDATE and DELETE both rejected unconditionally. A sixth table on the same
-- established append-only function, zero new SQL logic.
CREATE TRIGGER "document_reviews_append_only"
  BEFORE UPDATE OR DELETE ON "document_reviews"
  FOR EACH ROW EXECUTE FUNCTION "loadtopia_reject_mutation"();

-- rate_confirmations: DELETE is unconditionally rejected (same function as
-- above), but a narrow, purpose-built function permits UPDATE — ONLY for the
-- three generation-metadata columns (status, storage_key, generated_at).
-- Every commercial-snapshot column is compared OLD vs NEW and the statement
-- is rejected if any of them differ. This is intentionally NOT
-- loadtopia_reject_mutation(), which would also (wrongly) reject the
-- legitimate post-commit "mark generation complete" write.
CREATE TRIGGER "rate_confirmations_no_delete"
  BEFORE DELETE ON "rate_confirmations"
  FOR EACH ROW EXECUTE FUNCTION "loadtopia_reject_mutation"();

CREATE OR REPLACE FUNCTION "loadtopia_protect_commercial_snapshot"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."load_id" IS DISTINCT FROM OLD."load_id"
     OR NEW."reference_number" IS DISTINCT FROM OLD."reference_number"
     OR NEW."shipper_company_id" IS DISTINCT FROM OLD."shipper_company_id"
     OR NEW."shipper_company_name" IS DISTINCT FROM OLD."shipper_company_name"
     OR NEW."shipper_mc_number" IS DISTINCT FROM OLD."shipper_mc_number"
     OR NEW."shipper_dot_number" IS DISTINCT FROM OLD."shipper_dot_number"
     OR NEW."carrier_company_id" IS DISTINCT FROM OLD."carrier_company_id"
     OR NEW."carrier_company_name" IS DISTINCT FROM OLD."carrier_company_name"
     OR NEW."carrier_legal_name" IS DISTINCT FROM OLD."carrier_legal_name"
     OR NEW."carrier_mc_number" IS DISTINCT FROM OLD."carrier_mc_number"
     OR NEW."carrier_dot_number" IS DISTINCT FROM OLD."carrier_dot_number"
     OR NEW."origin_address_line1" IS DISTINCT FROM OLD."origin_address_line1"
     OR NEW."origin_address_line2" IS DISTINCT FROM OLD."origin_address_line2"
     OR NEW."origin_city" IS DISTINCT FROM OLD."origin_city"
     OR NEW."origin_state" IS DISTINCT FROM OLD."origin_state"
     OR NEW."origin_postal_code" IS DISTINCT FROM OLD."origin_postal_code"
     OR NEW."origin_country" IS DISTINCT FROM OLD."origin_country"
     OR NEW."destination_address_line1" IS DISTINCT FROM OLD."destination_address_line1"
     OR NEW."destination_address_line2" IS DISTINCT FROM OLD."destination_address_line2"
     OR NEW."destination_city" IS DISTINCT FROM OLD."destination_city"
     OR NEW."destination_state" IS DISTINCT FROM OLD."destination_state"
     OR NEW."destination_postal_code" IS DISTINCT FROM OLD."destination_postal_code"
     OR NEW."destination_country" IS DISTINCT FROM OLD."destination_country"
     OR NEW."pickup_window_start" IS DISTINCT FROM OLD."pickup_window_start"
     OR NEW."pickup_window_end" IS DISTINCT FROM OLD."pickup_window_end"
     OR NEW."delivery_window_start" IS DISTINCT FROM OLD."delivery_window_start"
     OR NEW."delivery_window_end" IS DISTINCT FROM OLD."delivery_window_end"
     OR NEW."equipment_type" IS DISTINCT FROM OLD."equipment_type"
     OR NEW."commodity" IS DISTINCT FROM OLD."commodity"
     OR NEW."weight_lbs" IS DISTINCT FROM OLD."weight_lbs"
     OR NEW."agreed_rate" IS DISTINCT FROM OLD."agreed_rate"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."distance_meters" IS DISTINCT FROM OLD."distance_meters"
     OR NEW."awarded_offer_round_id" IS DISTINCT FROM OLD."awarded_offer_round_id"
     OR NEW."awarded_at" IS DISTINCT FROM OLD."awarded_at"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'rate_confirmations: commercial snapshot fields are immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "rate_confirmations_protect_commercial_snapshot"
  BEFORE UPDATE ON "rate_confirmations"
  FOR EACH ROW EXECUTE FUNCTION "loadtopia_protect_commercial_snapshot"();
