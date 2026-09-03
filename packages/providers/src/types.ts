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
export interface SignedUploadRequest {
  key: string;
  contentType: string;
  maxBytes?: number;
}
export interface SignedUploadResult extends ProviderProvenance {
  url: string;
  method: "PUT" | "POST";
  headers: Record<string, string>;
  expiresAt: string;
}
export interface StorageProvider extends BaseProvider {
  createSignedUpload(request: SignedUploadRequest): Promise<SignedUploadResult>;
  createSignedDownload(key: string): Promise<{ url: string; expiresAt: string } & ProviderProvenance>;
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
  payment: PaymentProvider;
  storage: StorageProvider;
  notification: NotificationProvider;
  tracking: TrackingProvider;
}

export type ProviderName = keyof ProviderRegistry;
