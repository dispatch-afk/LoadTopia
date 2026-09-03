import type {
  CompanyType,
  EquipmentType,
  LoadEventType,
  LoadStatus,
  TransportMode,
  UserRole,
} from "./enums";

/**
 * A user's identity + the company context a request is acting on behalf of.
 * `companyId`/`companyType`/`role` always reflect the ACTIVE company (resolved
 * server-side from the session + an active membership), never a client claim.
 */
export interface AuthenticatedActor {
  userId: string;
  email: string;
  /** Active company. Null only for ADMIN staff accounts with no membership. */
  companyId: string | null;
  companyType: CompanyType | null;
  role: UserRole;
  /** Membership id for the active company, if any. */
  membershipId: string | null;
}

export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: string;
}

export interface MembershipView {
  membershipId: string;
  companyId: string;
  companyName: string;
  companyType: CompanyType;
  role: UserRole;
  isPrimary: boolean;
  isActive: boolean;
}

export interface MeResponse {
  user: PublicUser;
  memberships: MembershipView[];
  activeCompanyId: string | null;
  role: UserRole | null;
  permissions: string[];
}

export interface CompanyView {
  id: string;
  type: CompanyType;
  name: string;
  mcNumber: string | null;
  dotNumber: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  loadNumberPrefix: string;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyMemberView {
  membershipId: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  isPrimary: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface LocationView {
  id: string;
  companyId: string;
  name: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  latitude: string | null;
  longitude: string | null;
  isGeocoded: boolean;
  geocodedBy: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EquipmentView {
  id: string;
  companyId: string;
  type: EquipmentType;
  name: string | null;
  trailerLengthFt: number | null;
  capacityLbs: number | null;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LoadRouting {
  miles: number | null;
  driveTimeMinutes: number | null;
  provider: string | null;
  isMock: boolean;
  routedAt: string | null;
}

export interface LoadEventView {
  id: string;
  type: LoadEventType;
  fromStatus: LoadStatus | null;
  toStatus: LoadStatus | null;
  actorUserId: string | null;
  actorName: string | null;
  note: string | null;
  createdAt: string;
}

export interface LoadListItem {
  id: string;
  referenceNumber: string;
  status: LoadStatus;
  equipmentType: EquipmentType;
  mode: TransportMode;
  weightLbs: number | null;
  commodity: string | null;
  origin: { city: string; state: string };
  destination: { city: string; state: string };
  pickupWindowStart: string | null;
  pickupWindowEnd: string | null;
  deliveryWindowStart: string | null;
  deliveryWindowEnd: string | null;
  miles: number | null;
  createdAt: string;
}

export interface LoadView {
  id: string;
  referenceNumber: string;
  status: LoadStatus;
  shipperCompanyId: string;
  equipmentType: EquipmentType;
  mode: TransportMode;
  commodity: string | null;
  weightLbs: number | null;
  origin: LocationView;
  destination: LocationView;
  pickupWindowStart: string | null;
  pickupWindowEnd: string | null;
  deliveryWindowStart: string | null;
  deliveryWindowEnd: string | null;
  routing: LoadRouting;
  availableTransitions: LoadStatus[];
  createdByUserId: string;
  updatedByUserId: string | null;
  postedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  events: LoadEventView[];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

export type HealthStatus = "ok" | "degraded" | "error";

export interface HealthReport {
  status: HealthStatus;
  service: string;
  version: string;
  timestamp: string;
  uptimeSeconds: number;
  checks: {
    database: { status: HealthStatus; latencyMs: number | null; message?: string };
    providers: Record<string, { status: HealthStatus; isMock: boolean; message?: string }>;
  };
}
