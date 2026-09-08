import "server-only";
import type { CheckInView, DocumentView, RateConfirmationView } from "@loadtopia/shared";
import { ApiError, apiServer } from "./api-server";

/**
 * Server-side fetches for the operational sections of a load page. Check-ins
 * and documents are best-effort — a load that never reached operations simply
 * has none, and a transient error should not blank the whole page.
 */

export async function fetchCheckIns(loadId: string): Promise<CheckInView[]> {
  try {
    const { data } = await apiServer<{ data: CheckInView[] }>(`/api/loads/${loadId}/check-ins`);
    return data;
  } catch {
    return [];
  }
}

export async function fetchDocuments(loadId: string): Promise<DocumentView[]> {
  try {
    const { data } = await apiServer<{ data: DocumentView[] }>(`/api/loads/${loadId}/documents`);
    return data;
  } catch {
    return [];
  }
}

/**
 * `RateConfirmationView` when one exists (generated or pending), the literal
 * `"unavailable"` for a historical load (`RATE_CONFIRMATION_NOT_AVAILABLE`),
 * or `null` when the section should be hidden (not authorized / transient).
 */
export async function fetchRateConfirmation(
  loadId: string,
): Promise<RateConfirmationView | "unavailable" | null> {
  try {
    return await apiServer<RateConfirmationView>(`/api/loads/${loadId}/rate-confirmation`);
  } catch (err) {
    if (err instanceof ApiError && err.code === "RATE_CONFIRMATION_NOT_AVAILABLE") {
      return "unavailable";
    }
    return null;
  }
}
