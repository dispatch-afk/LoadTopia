-- Milestone 3 closeout: enforce append-only on load_check_ins at the DATABASE
-- level, matching every other immutable operational-history table
-- (load_events, document_reviews, offer_rounds, offer_events, pricing_snapshots).
--
-- Manual check-ins are immutable operational history. Until now that was
-- guaranteed only by the ABSENCE of an UPDATE/DELETE code path (there is no
-- PATCH/DELETE endpoint and the service never mutates a row). This adds the
-- database backstop the sibling tables already have, reusing the SAME generic
-- loadtopia_reject_mutation() function from m1_foundation.
--
-- Purely additive: one trigger. No new function, no schema/column change, no
-- data change, no change to the check-in API, authorization, or event semantics.
--
--   INSERT : allowed.
--   UPDATE : rejected unconditionally.
--   DELETE : rejected, EXCEPT inside a transaction that has opted in via
--            SET LOCAL "loadtopia.allow_event_delete" = 'on' — the existing
--            "delete a DRAFT load" cascade path. A DRAFT load can never have a
--            check-in (check-ins require CARRIER_ASSIGNED..DELIVERED), so this
--            escape hatch never actually removes real check-in history.

CREATE TRIGGER "load_check_ins_append_only"
  BEFORE UPDATE OR DELETE ON "load_check_ins"
  FOR EACH ROW EXECUTE FUNCTION "loadtopia_reject_mutation"();
