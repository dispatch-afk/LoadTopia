import { type AuthenticatedActor, CompanyType, LoadStatus, UserRole } from "@loadtopia/shared";
import { describe, expect, it } from "vitest";
import {
  AuthorizationError,
  ResourceScopeError,
  assertCanModifyLoad,
  assertCanOperateShipment,
  assertCompanyScope,
  assertPermission,
  canModifyLoad,
  canOperateShipment,
  canReadLoad,
  hasPermission,
  isSameCompany,
} from "./policy";
import { Permission } from "./permissions";

const shipper: AuthenticatedActor = {
  userId: "u-ship",
  email: "ship@acme.test",
  companyId: "co-shipper",
  companyType: CompanyType.SHIPPER,
  role: UserRole.SHIPPER,
  membershipId: "m-ship",
};
const otherShipper: AuthenticatedActor = {
  ...shipper,
  userId: "u-ship2",
  companyId: "co-shipper-2",
  membershipId: "m-ship2",
};
const carrier: AuthenticatedActor = {
  userId: "u-car",
  email: "car@haul.test",
  companyId: "co-carrier",
  companyType: CompanyType.CARRIER,
  role: UserRole.CARRIER,
  membershipId: "m-car",
};
const admin: AuthenticatedActor = {
  userId: "u-admin",
  email: "ops@loadtopia.test",
  companyId: null,
  companyType: null,
  role: UserRole.ADMIN,
  membershipId: null,
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

  it("grants both roles their own company + location + equipment management", () => {
    for (const actor of [shipper, carrier]) {
      expect(hasPermission(actor, Permission.LOCATION_MANAGE)).toBe(true);
      expect(hasPermission(actor, Permission.EQUIPMENT_MANAGE)).toBe(true);
      expect(hasPermission(actor, Permission.COMPANY_UPDATE_OWN)).toBe(true);
      expect(hasPermission(actor, Permission.MEMBERSHIP_MANAGE)).toBe(true);
    }
  });

  it("does not grant carriers any load permission", () => {
    expect(hasPermission(carrier, Permission.LOAD_READ_OWN)).toBe(false);
    expect(hasPermission(carrier, Permission.LOAD_UPDATE_OWN)).toBe(false);
    expect(hasPermission(carrier, Permission.LOAD_POST)).toBe(false);
  });

  it("grants carriers the Milestone 3 shipment-operation permission, and only carriers", () => {
    expect(hasPermission(carrier, Permission.SHIPMENT_OPERATE_ASSIGNED)).toBe(true);
    expect(hasPermission(shipper, Permission.SHIPMENT_OPERATE_ASSIGNED)).toBe(false);
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

describe("company scope", () => {
  it("passes for the actor's own active company and for admin", () => {
    expect(isSameCompany(shipper, "co-shipper")).toBe(true);
    expect(isSameCompany(admin, "co-shipper")).toBe(true);
    expect(() => assertCompanyScope(shipper, "co-shipper")).not.toThrow();
  });

  it("raises a 404-style ResourceScopeError for another company's resource", () => {
    expect(isSameCompany(shipper, "co-shipper-2")).toBe(false);
    try {
      assertCompanyScope(shipper, "co-shipper-2");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ResourceScopeError);
      expect((err as ResourceScopeError).statusCode).toBe(404);
    }
  });
});

describe("load resource policy", () => {
  const load = { shipperCompanyId: "co-shipper", carrierCompanyId: null as string | null };

  it("lets the owning shipper read and modify its load", () => {
    expect(canReadLoad(shipper, load)).toBe(true);
    expect(canModifyLoad(shipper, load)).toBe(true);
  });

  it("hides a load from any other company (shipper or carrier) — IDOR guard", () => {
    expect(canReadLoad(otherShipper, load)).toBe(false);
    expect(canReadLoad(carrier, load)).toBe(false);
    expect(() => assertCanModifyLoad(otherShipper, load)).toThrow(ResourceScopeError);
  });

  it("lets admin read and modify any load", () => {
    expect(canReadLoad(admin, load)).toBe(true);
    expect(canModifyLoad(admin, load)).toBe(true);
  });
});

describe("shipment operation policy (Milestone 3)", () => {
  const assigned = { shipperCompanyId: "co-shipper", carrierCompanyId: "co-carrier" };
  const otherCarrier: AuthenticatedActor = {
    ...carrier,
    userId: "u-car2",
    companyId: "co-carrier-2",
    membershipId: "m-car2",
  };

  it("lets the assigned carrier operate a CARRIER_ASSIGNED-or-later shipment", () => {
    for (const status of [
      LoadStatus.CARRIER_ASSIGNED,
      LoadStatus.PICKED_UP,
      LoadStatus.IN_TRANSIT,
      LoadStatus.DELIVERED,
      LoadStatus.COMPLETED,
    ]) {
      expect(canOperateShipment(carrier, { ...assigned, status })).toBe(true);
    }
  });

  it("denies the carrier during the AWARDED window — before the shipper confirms assignment", () => {
    expect(canOperateShipment(carrier, { ...assigned, status: LoadStatus.AWARDED })).toBe(false);
  });

  it("never lets an unassigned carrier operate — assertCanOperateShipment 404s, not 403s", () => {
    expect(canOperateShipment(otherCarrier, { ...assigned, status: LoadStatus.CARRIER_ASSIGNED })).toBe(
      false,
    );
    expect(() =>
      assertCanOperateShipment(otherCarrier, { ...assigned, status: LoadStatus.CARRIER_ASSIGNED }),
    ).toThrow(ResourceScopeError);
  });

  it("never lets the owning shipper operate the shipment — canModifyLoad stays the shipper's boundary", () => {
    expect(canOperateShipment(shipper, { ...assigned, status: LoadStatus.CARRIER_ASSIGNED })).toBe(
      false,
    );
    expect(() =>
      assertCanOperateShipment(shipper, { ...assigned, status: LoadStatus.CARRIER_ASSIGNED }),
    ).toThrow(AuthorizationError);
  });

  it("lets admin operate any shipment", () => {
    expect(canOperateShipment(admin, { ...assigned, status: LoadStatus.PICKED_UP })).toBe(true);
  });
});
