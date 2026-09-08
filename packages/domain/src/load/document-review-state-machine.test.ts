import { DocumentReviewStatus } from "@loadtopia/shared";
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_REVIEW_TRANSITIONS,
  DocumentReviewTransitionError,
  assertDocumentReviewTransition,
  canTransitionDocumentReview,
  isTerminalDocumentReviewStatus,
} from "./document-review-state-machine";

describe("document review state machine", () => {
  it("defines transitions for every review status exactly once", () => {
    for (const status of Object.values(DocumentReviewStatus)) {
      expect(DOCUMENT_REVIEW_TRANSITIONS).toHaveProperty(status);
    }
  });

  it("allows PENDING_REVIEW to move to APPROVED or REJECTED", () => {
    expect(canTransitionDocumentReview(DocumentReviewStatus.PENDING_REVIEW, DocumentReviewStatus.APPROVED)).toBe(
      true,
    );
    expect(
      canTransitionDocumentReview(DocumentReviewStatus.PENDING_REVIEW, DocumentReviewStatus.REJECTED),
    ).toBe(true);
  });

  it("treats APPROVED and REJECTED as terminal — no path back, ever", () => {
    expect(isTerminalDocumentReviewStatus(DocumentReviewStatus.APPROVED)).toBe(true);
    expect(isTerminalDocumentReviewStatus(DocumentReviewStatus.REJECTED)).toBe(true);
    expect(isTerminalDocumentReviewStatus(DocumentReviewStatus.PENDING_REVIEW)).toBe(false);

    expect(
      canTransitionDocumentReview(DocumentReviewStatus.APPROVED, DocumentReviewStatus.REJECTED),
    ).toBe(false);
    expect(
      canTransitionDocumentReview(DocumentReviewStatus.APPROVED, DocumentReviewStatus.PENDING_REVIEW),
    ).toBe(false);
    expect(
      canTransitionDocumentReview(DocumentReviewStatus.REJECTED, DocumentReviewStatus.APPROVED),
    ).toBe(false);
    expect(
      canTransitionDocumentReview(DocumentReviewStatus.REJECTED, DocumentReviewStatus.PENDING_REVIEW),
    ).toBe(false);
  });

  it("throws DocumentReviewTransitionError from assertDocumentReviewTransition on an illegal move", () => {
    expect(() =>
      assertDocumentReviewTransition(DocumentReviewStatus.REJECTED, DocumentReviewStatus.APPROVED),
    ).toThrow(DocumentReviewTransitionError);
    expect(() =>
      assertDocumentReviewTransition(DocumentReviewStatus.PENDING_REVIEW, DocumentReviewStatus.APPROVED),
    ).not.toThrow();
  });
});
