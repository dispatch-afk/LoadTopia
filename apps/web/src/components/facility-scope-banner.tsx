import { Alert } from "./ui";

/**
 * Milestone 4 Phase 11: a subtle, factual explanation shown ONLY to a
 * facility-scoped shipper user, on own-company freight workspaces where a
 * narrower view would otherwise be unexplained. Deliberately states only the
 * viewer's own access mode — never a count of hidden freight, never a
 * comparison to the company's total. Render nothing for a company-wide user
 * (`scoped` false) or when scope status cannot be determined (`scoped`
 * null, e.g. no active membership).
 */
export function FacilityScopeBanner({ scoped }: { scoped: boolean | null }) {
  if (scoped !== true) return null;
  return (
    <div className="mb-4">
      <Alert tone="info">Showing freight for your assigned facilities.</Alert>
    </div>
  );
}
