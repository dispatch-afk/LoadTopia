import type { HealthStatus } from "@loadtopia/shared";

/**
 * External-service abstraction layer.
 *
 * Every integration LoadTopia depends on (routing, pricing, geocoding, payments,
 * file storage, notifications, shipment tracking) is expressed as an interface
 * here. The application code depends ONLY on these interfaces, never on a vendor
 * SDK. Swapping DAT for Truckstop, or Stripe for Adyen, must be a one-file change
 * in this package plus configuration — nothing in `apps/*` should change.
 */

/** Provenance metadata attached to every provider response. */
export interface ProviderProvenance {
  /** Adapter identifier, e.g. "mock", "dat", "stripe". */
  provider: string;
  /** True when the data is synthetic/development-only and must not be shown as real. */
  isMock: boolean;
  /** ISO-8601 UTC timestamp of when the result was produced/retrieved. */
  retrievedAt: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderHealth {
  status: HealthStatus;
  isMock: boolean;
  message?: string;
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface PostalAddress {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

interface BaseProvider {
  readonly name: string;
  readonly isMock: boolean;
  health(): Promise<ProviderHealth>;
}

// --- Routing -----------------------------------------------------------------
export interface RouteRequest {
  origin: GeoPoint;
  destination: GeoPoint;
  equipmentType?: string;
}
export interface RouteResult extends ProviderProvenance {
  distanceMeters: number;
  durationSeconds: number;
  /**
   * Encoded route polyline, when the adapter requested and Google returned
   * one. Transient only — no current call site persists this (see
   * `apps/api/src/modules/loads/routing.ts`). Reserved so a future Places
   * "search along route" provider can consume it without another
   * RoutingProvider interface change.
   */
  encodedPolyline?: string;
}
export interface RoutingProvider extends BaseProvider {
  getRoute(request: RouteRequest): Promise<RouteResult>;
}

// --- Pricing ---------------------------------------------------------------- -
export interface PriceEstimateRequest {
  originRegion: string;
  destinationRegion: string;
  equipmentType: string;
  distanceMeters?: number;
  pickupDate?: string;
}
export interface PriceEstimate extends ProviderProvenance {
  currency: string;
  lowRate: string;
  midRate: string;
  highRate: string;
  ratePerMile: string | null;
  confidence: "low" | "medium" | "high";
  /** Non-empty for mock/estimated data. Surfaced to users verbatim. */
  disclaimer: string | null;
}
// --- Carrier verification (Milestone 2) ------------------------------------ --
export interface CarrierVerificationRequest {
  legalName: string;
  mcNumber?: string;
  dotNumber?: string;
}
export interface CarrierVerificationResult extends ProviderProvenance {
  /** `verified` = safe to admit to the marketplace; `failed`/`not_found` = not. */
  status: "verified" | "failed" | "not_found";
  authorityStatus: "active" | "inactive" | "unknown";
  insuranceOnFile: boolean | null;
  reference: string | null;
  /**
   * Non-null for mock/synthetic checks. This is NOT FMCSA / DOT / SAFER /
   * insurance / government verification and must never be presented as such.
   */
  disclaimer: string | null;
}
export interface CarrierVerificationProvider extends BaseProvider {
  verify(request: CarrierVerificationRequest): Promise<CarrierVerificationResult>;
}

export interface PricingProvider extends BaseProvider {
  estimate(request: PriceEstimateRequest): Promise<PriceEstimate>;
}

// --- Geocoding ------------------------------------------------------------- ---
export interface GeocodeResult extends ProviderProvenance {
  point: GeoPoint;
  normalizedAddress: PostalAddress;
}
export interface GeocodingProvider extends BaseProvider {
  geocode(address: PostalAddress): Promise<GeocodeResult>;
}

// --- Payments ------------------------------------------------------------- ---
export interface PaymentIntentRequest {
  amount: string;
  currency: string;
  referenceId: string;
  description?: string;
}
export interface PaymentIntentResult extends ProviderProvenance {
  intentId: string;
  status: "requires_confirmation" | "processing" | "succeeded" | "failed";
}
export interface PayoutRequest {
  amount: string;
  currency: string;
  carrierAccountRef: string;
  referenceId: string;
}
export interface PayoutResult extends ProviderProvenance {
  payoutId: string;
  status: "pending" | "paid" | "failed";
}
export interface PaymentProvider extends BaseProvider {
  createPaymentIntent(request: PaymentIntentRequest): Promise<PaymentIntentResult>;
  createPayout(request: PayoutRequest): Promise<PayoutResult>;
}

// --- Storage ------------------------------------------------------------- ---

/**
 * A trusted, server-constructed upload authorization request. Every field is
 * chosen by the API/service layer from the approved document rules — never by
 * the browser. `key` is a server-generated object key; `maxBytes` is a hard
 * upper bound the storage layer itself must enforce (see `SignedUploadResult`).
 */
export interface SignedUploadRequest {
  key: string;
  contentType: string;
  /** Hard maximum object size. Required — a signed upload with no size bound
   *  cannot be enforced at the storage layer and must never be issued. */
  maxBytes: number;
}
export interface SignedUploadResult extends ProviderProvenance {
  url: string;
  method: "PUT" | "POST";
  headers: Record<string, string>;
  /**
   * Presigned-POST form fields the browser must submit verbatim as multipart
   * form-data alongside the file. Present when `method === "POST"` (the S3
   * path — the only mechanism that genuinely enforces `content-length-range`
   * and an exact `Content-Type` at the storage layer). Absent for `PUT`.
   */
  fields?: Record<string, string>;
  expiresAt: string;
}

/** Authoritative metadata for a stored object, from a HEAD-equivalent lookup.
 *  Establishes storage facts only — it does NOT prove the bytes are a
 *  semantically valid PDF/image, and `etag` is not a security signal. */
export interface StoredObjectMetadata {
  key: string;
  contentLength: number;
  /** Null when the store does not expose a stored Content-Type. */
  contentType: string | null;
  etag?: string;
}

/** A server-side write of generated content (e.g. a rendered Rate
 *  Confirmation PDF) — no browser upload URL involved. */
export interface PutObjectRequest {
  key: string;
  contentType: string;
  body: Uint8Array;
}

export interface StorageProvider extends BaseProvider {
  createSignedUpload(request: SignedUploadRequest): Promise<SignedUploadResult>;
  createSignedDownload(key: string): Promise<{ url: string; expiresAt: string } & ProviderProvenance>;
  /**
   * HEAD-equivalent. Returns authoritative metadata for a stored object, or
   * `null` if it does not exist. Used by the two-stage upload CONFIRM step to
   * check the client's PUT/POST actually landed the expected object.
   */
  headObject(key: string): Promise<StoredObjectMetadata | null>;
  /**
   * Store `body` under the caller's exact `key`. Overwrites the same
   * deterministic key idempotently on retry — never generates a key
   * internally. Used for server-generated artifacts.
   */
  putObject(request: PutObjectRequest): Promise<{ key: string } & ProviderProvenance>;
}

// --- Notifications ------------------------------------------------------- ---
export interface NotificationMessage {
  channel: "email" | "sms" | "webhook";
  to: string;
  template: string;
  data: Record<string, unknown>;
}
export interface NotificationResult extends ProviderProvenance {
  messageId: string;
  accepted: boolean;
}
export interface NotificationProvider extends BaseProvider {
  send(message: NotificationMessage): Promise<NotificationResult>;
}

// --- Tracking ------------------------------------------------------------- ---
export interface TrackingSubscriptionRequest {
  loadId: string;
  carrierRef: string;
}
export interface TrackingPosition extends ProviderProvenance {
  loadId: string;
  point: GeoPoint;
  recordedAt: string;
}
export interface TrackingProvider extends BaseProvider {
  subscribe(request: TrackingSubscriptionRequest): Promise<{ subscriptionId: string } & ProviderProvenance>;
  getLatestPosition(loadId: string): Promise<TrackingPosition | null>;
}

export interface ProviderRegistry {
  routing: RoutingProvider;
  pricing: PricingProvider;
  geocoding: GeocodingProvider;
  carrierVerification: CarrierVerificationProvider;
  payment: PaymentProvider;
  storage: StorageProvider;
  notification: NotificationProvider;
  tracking: TrackingProvider;
}

export type ProviderName = keyof ProviderRegistry;
