import { describe, expect, it } from "vitest";
import { CompanyType, UserRole } from "../enums";
import { loginSchema, registerSchema, roleForCompanyType } from "./auth";

describe("registerSchema", () => {
  const valid = {
    email: "Dispatch@Example.com",
    password: "correct-horse-battery",
    firstName: "Sam",
    lastName: "Rivera",
    companyName: "Rivera Freight",
    companyType: CompanyType.CARRIER,
  };

  it("accepts a valid payload and normalizes the email", () => {
    const parsed = registerSchema.parse(valid);
    expect(parsed.email).toBe("dispatch@example.com");
  });

  it("rejects a short password", () => {
    expect(registerSchema.safeParse({ ...valid, password: "short" }).success).toBe(false);
  });

  it("rejects unknown fields (strict)", () => {
    expect(registerSchema.safeParse({ ...valid, role: "ADMIN" }).success).toBe(false);
  });
});

describe("roleForCompanyType", () => {
  it("maps SHIPPER company to SHIPPER role", () => {
    expect(roleForCompanyType(CompanyType.SHIPPER)).toBe(UserRole.SHIPPER);
  });
  it("maps CARRIER company to CARRIER role", () => {
    expect(roleForCompanyType(CompanyType.CARRIER)).toBe(UserRole.CARRIER);
  });
});

describe("loginSchema", () => {
  it("requires a non-empty password", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
  });
});
