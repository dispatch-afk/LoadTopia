import type {
  GeocodeResult,
  GeocodingProvider,
  NotificationMessage,
  NotificationProvider,
  NotificationResult,
  PaymentIntentRequest,
  PaymentIntentResult,
  PaymentProvider,
  PayoutRequest,
  PayoutResult,
  PostalAddress,
  ProviderHealth,
  ProviderProvenance,
  SignedUploadRequest,
  SignedUploadResult,
  StorageProvider,
  TrackingPosition,
  TrackingProvider,
  TrackingSubscriptionRequest,
} from "../types";
import { mockProvenance, seededValue } from "./shared";

const okHealth = (what: string): ProviderHealth => ({
  status: "ok",
  isMock: true,
  message: `mock ${what} provider (development)`,
});

/** MockGeocodingProvider — DEVELOPMENT ONLY. Deterministic pseudo-coordinates. */
export class MockGeocodingProvider implements GeocodingProvider {
  readonly name = "mock";
  readonly isMock = true;

  async geocode(address: PostalAddress): Promise<GeocodeResult> {
    const seed = `${address.postalCode}|${address.city}|${address.region}`;
    return {
      point: {
        latitude: Number(seededValue(seed + "lat", 25, 49).toFixed(6)),
        longitude: Number(seededValue(seed + "lon", -124, -67).toFixed(6)),
      },
      normalizedAddress: { ...address, country: address.country || "US" },
      ...mockProvenance(),
    };
  }

  health = async () => okHealth("geocoding");
}

/** MockPaymentProvider — DEVELOPMENT ONLY. Moves no money. */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";
  readonly isMock = true;

  async createPaymentIntent(request: PaymentIntentRequest): Promise<PaymentIntentResult> {
    return {
      intentId: `mock_pi_${request.referenceId}`,
      status: "requires_confirmation",
      ...mockProvenance({ amount: request.amount, currency: request.currency }),
    };
  }

  async createPayout(request: PayoutRequest): Promise<PayoutResult> {
    return {
      payoutId: `mock_po_${request.referenceId}`,
      status: "pending",
      ...mockProvenance({ amount: request.amount, currency: request.currency }),
    };
  }

  health = async () => okHealth("payment");
}

/** MockStorageProvider — DEVELOPMENT ONLY. Returns non-functional URLs. */
export class MockStorageProvider implements StorageProvider {
  readonly name = "mock";
  readonly isMock = true;

  async createSignedUpload(request: SignedUploadRequest): Promise<SignedUploadResult> {
    return {
      url: `https://mock-storage.local/upload/${encodeURIComponent(request.key)}`,
      method: "PUT",
      headers: { "content-type": request.contentType },
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      ...mockProvenance(),
    };
  }

  async createSignedDownload(
    key: string,
  ): Promise<{ url: string; expiresAt: string } & ProviderProvenance> {
    return {
      url: `https://mock-storage.local/download/${encodeURIComponent(key)}`,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      ...mockProvenance(),
    };
  }

  health = async () => okHealth("storage");
}

/** MockNotificationProvider — DEVELOPMENT ONLY. Logs instead of sending. */
export class MockNotificationProvider implements NotificationProvider {
  readonly name = "mock";
  readonly isMock = true;

  async send(message: NotificationMessage): Promise<NotificationResult> {
    return {
      messageId: `mock_msg_${Date.now()}`,
      accepted: true,
      ...mockProvenance({ channel: message.channel, template: message.template, to: message.to }),
    };
  }

  health = async () => okHealth("notification");
}

/** MockTrackingProvider — DEVELOPMENT ONLY. No real telematics. */
export class MockTrackingProvider implements TrackingProvider {
  readonly name = "mock";
  readonly isMock = true;

  async subscribe(
    request: TrackingSubscriptionRequest,
  ): Promise<{ subscriptionId: string } & ProviderProvenance> {
    return { subscriptionId: `mock_sub_${request.loadId}`, ...mockProvenance() };
  }

  async getLatestPosition(_loadId: string): Promise<TrackingPosition | null> {
    return null;
  }

  health = async () => okHealth("tracking");
}
