import { type AuthenticatedActor, CompanyType, UserRole } from "@loadtopia/shared";
import { describe, expect, it } from "vitest";
import {
  AuthorizationError,
  assertPermission,
  canModifyLoad,
  canReadLoad,
  hasPermission,
} from "./policy";
import { Permission } from "./permissions";

const shipper: AuthenticatedActor = {
  userId: "u-ship",
  email: "ship@acme.test",
  companyId: "co-shipper",
  companyType: CompanyType.SHIPPER,
  role: UserRole.SHIPPER,
};
const carrier: AuthenticatedActor = {
  userId: "u-car",
  email: "car@haul.test",
  companyId: "co-carrier",
  companyType: CompanyType.CARRIER,
  role: UserRole.CARRIER,
};
const admin: AuthenticatedActor = {
  userId: "u-admin",
  email: "ops@loadtopia.test",
  companyId: null,
  companyType: null,
  role: UserRole.ADMIN,
};

describe("permission checks", () => {
  it("grants shippers load creation but not carriers", () => {
    expect(hasPermission(shipper, Permission.LOAD_CREATE)).toBe(true);
    expect(hasPermission(carrier, Permission.LOAD_CREATE)).toBe(false);
  });

  it("grants carriers offer creation but not shippers", () => {
    expect(hasPermission(carrier, Permission.OFFER_CREATE)).toBe(true);
    expect(hasPermission(shipper, Permission.OFFER_CREATE)).toBe(false);
  });

  it("grants admin every permission", () => {
    expect(hasPermission(admin, Permission.ADMIN_PANEL)).toBe(true);
    expect(hasPermission(admin, Permission.LOAD_CREATE)).toBe(true);
    expect(hasPermission(admin, Permission.OFFER_CREATE)).toBe(true);
  });

  it("assertPermission throws AuthorizationError when denied", () => {
    expect(() => assertPermission(carrier, Permission.LOAD_CREATE)).toThrow(AuthorizationError);
    expect(() => assertPermission(shipper, Permission.LOAD_CREATE)).not.toThrow();
  });
});

describe("load resource policy", () => {
  const load = { shipperCompanyId: "co-shipper", carrierCompanyId: null as string | null };

  it("lets the owning shipper read and modify its load", () => {
    expect(canReadLoad(shipper, load)).toBe(true);
    expect(canModifyLoad(shipper, load)).toBe(true);
  });

  it("hides a load from an unrelated carrier until assigned", () => {
    expect(canReadLoad(carrier, load)).toBe(false);
    expect(canReadLoad(carrier, { ...load, carrierCompanyId: "co-carrier" })).toBe(true);
  });

  it("never lets an assigned carrier modify load details", () => {
    expect(canModifyLoad(carrier, { ...load, carrierCompanyId: "co-carrier" })).toBe(false);
  });

  it("lets admin read and modify any load", () => {
    expect(canReadLoad(admin, load)).toBe(true);
    expect(canModifyLoad(admin, load)).toBe(true);
  });
});
