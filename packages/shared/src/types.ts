import type { CompanyType, UserRole } from "./enums";

/** A user's identity + the company context a request is acting within. */
export interface AuthenticatedActor {
  userId: string;
  email: string;
  /** Null only for ADMIN users with no company membership. */
  companyId: string | null;
  companyType: CompanyType | null;
  role: UserRole;
}

export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: string;
}

export interface MembershipView {
  companyId: string;
  companyName: string;
  companyType: CompanyType;
  role: UserRole;
  isPrimary: boolean;
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
