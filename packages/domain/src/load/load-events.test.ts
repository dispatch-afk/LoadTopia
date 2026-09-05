import { LoadEventType, LoadStatus } from "@loadtopia/shared";
import { describe, expect, it } from "vitest";
import {
  buildCheckInAddedEvent,
  buildDocumentRemovedEvent,
  buildDocumentReviewedEvent,
  buildDocumentUploadedEvent,
  buildExceptionReportedEvent,
  buildLoadCreatedEvent,
  buildLoadUpdatedEvent,
  buildNoteAddedEvent,
  buildStatusChangeEvent,
} from "./load-events";

describe("load event builders", () => {
  it("captures actorCompanyId when supplied, and defaults to null when omitted", () => {
    const withCompany = buildStatusChangeEvent({
      loadId: "l1",
      fromStatus: LoadStatus.POSTED,
      toStatus: LoadStatus.OFFER_RECEIVED,
      actorUserId: "u1",
      actorCompanyId: "co1",
    });
    expect(withCompany.actorCompanyId).toBe("co1");

    const withoutCompany = buildLoadCreatedEvent({
      loadId: "l1",
      actorUserId: "u1",
      initialStatus: LoadStatus.DRAFT,
    });
    expect(withoutCompany.actorCompanyId).toBeNull();
  });

  it("carries changedFields through buildLoadUpdatedEvent", () => {
    const draft = buildLoadUpdatedEvent({
      loadId: "l1",
      actorUserId: "u1",
      actorCompanyId: "co1",
      changedFields: ["commodity", "weightLbs"],
    });
    expect(draft.type).toBe(LoadEventType.UPDATED);
    expect(draft.data).toEqual({ changedFields: ["commodity", "weightLbs"] });
  });

  it("builds every Milestone 3 event type with mandatory actor company attribution", () => {
    const checkIn = buildCheckInAddedEvent({
      loadId: "l1",
      actorUserId: "u-car",
      actorCompanyId: "co-carrier",
      checkInId: "ci1",
      city: "Dallas",
      state: "TX",
    });
    expect(checkIn.type).toBe(LoadEventType.CHECK_IN_ADDED);
    expect(checkIn.actorCompanyId).toBe("co-carrier");
    expect(checkIn.data).toEqual({ checkInId: "ci1", city: "Dallas", state: "TX" });

    const uploaded = buildDocumentUploadedEvent({
      loadId: "l1",
      actorUserId: "u-car",
      actorCompanyId: "co-carrier",
      documentId: "doc1",
      docType: "POD",
    });
    expect(uploaded.type).toBe(LoadEventType.DOCUMENT_UPLOADED);

    const reviewedReject = buildDocumentReviewedEvent({
      loadId: "l1",
      actorUserId: "u-ship",
      actorCompanyId: "co-shipper",
      documentId: "doc1",
      decision: "REJECTED",
      reason: "illegible signature",
    });
    expect(reviewedReject.data).toEqual({
      documentId: "doc1",
      decision: "REJECTED",
      reason: "illegible signature",
    });

    const reviewedApprove = buildDocumentReviewedEvent({
      loadId: "l1",
      actorUserId: "u-ship",
      actorCompanyId: "co-shipper",
      documentId: "doc1",
      decision: "APPROVED",
    });
    // No `reason` key at all when approving — never a stray null/empty string.
    expect(reviewedApprove.data).toEqual({ documentId: "doc1", decision: "APPROVED" });

    const removed = buildDocumentRemovedEvent({
      loadId: "l1",
      actorUserId: "u-car",
      actorCompanyId: "co-carrier",
      documentId: "doc1",
    });
    expect(removed.type).toBe(LoadEventType.DOCUMENT_REMOVED);

    const exception = buildExceptionReportedEvent({
      loadId: "l1",
      actorUserId: "u-car",
      actorCompanyId: "co-carrier",
      category: "delivery_delayed",
      note: "dock congestion",
    });
    expect(exception.type).toBe(LoadEventType.EXCEPTION_REPORTED);
    expect(exception.note).toBe("dock congestion");
    expect(exception.data).toEqual({ category: "delivery_delayed" });

    const note = buildNoteAddedEvent({
      loadId: "l1",
      actorUserId: "u-ship",
      actorCompanyId: "co-shipper",
      note: "please call ahead",
    });
    expect(note.type).toBe(LoadEventType.NOTE_ADDED);
    expect(note.note).toBe("please call ahead");
  });
});
