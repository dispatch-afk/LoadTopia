import type { CompanyBlockStatus, ConnectionStatus, LoadStatus, OfferThreadStatus } from "@loadtopia/shared";

/** The tone vocabulary `Badge` accepts. */
export type BadgeTone = "gray" | "green" | "amber" | "red" | "indigo";

/** Canonical offer-negotiation status → badge tone, shared by every screen
 *  that lists offer threads (previously duplicated per-page). */
export const OFFER_THREAD_STATUS_TONE: Record<OfferThreadStatus, BadgeTone> = {
  ACTIVE: "amber",
  ACCEPTED: "green",
  REJECTED: "red",
  WITHDRAWN: "gray",
  EXPIRED: "gray",
};

/** Canonical load-lifecycle status → badge tone (matches the values
 *  `LoadStatusBadge` has always used — consolidated here, not changed). */
export const LOAD_STATUS_TONE: Record<LoadStatus, BadgeTone> = {
  DRAFT: "gray",
  POSTED: "indigo",
  OFFER_RECEIVED: "amber",
  AWARDED: "green",
  CARRIER_ASSIGNED: "green",
  PICKED_UP: "amber",
  IN_TRANSIT: "amber",
  DELIVERED: "amber",
  COMPLETED: "green",
  CANCELLED: "red",
};

/** Connection lifecycle status → badge tone. */
export const CONNECTION_STATUS_TONE: Record<ConnectionStatus, BadgeTone> = {
  PENDING: "amber",
  ACCEPTED: "green",
  DECLINED: "gray",
  DISCONNECTED: "gray",
};

/** Connection lifecycle status → factual, non-editorial label. */
export const CONNECTION_STATUS_LABEL: Record<ConnectionStatus, string> = {
  PENDING: "Connection requested",
  ACCEPTED: "Connected",
  DECLINED: "Declined",
  DISCONNECTED: "Disconnected",
};

/** Block episode status → badge tone (shown only to the blocking company). */
export const BLOCK_STATUS_TONE: Record<CompanyBlockStatus, BadgeTone> = {
  ACTIVE: "red",
  PENDING_ON_COMPLETION: "amber",
  INACTIVE: "gray",
};
