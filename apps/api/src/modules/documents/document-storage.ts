/**
 * Server-generated object key for an operational document.
 *
 * Exactly Rev. 2 §3 / §9: `loads/{loadId}/documents/{documentId}`. Both
 * components are server-allocated UUIDs — the browser never chooses any part of
 * the key, and the original filename is NEVER object identity. Passes
 * `assertSafeObjectKey` (UUID segments only), so there is no path-traversal
 * surface. Stable for the lifetime of the upload intent, so a retry of the
 * confirm step inspects the same object.
 */
export function operationalDocumentStorageKey(loadId: string, documentId: string): string {
  return `loads/${loadId}/documents/${documentId}`;
}
