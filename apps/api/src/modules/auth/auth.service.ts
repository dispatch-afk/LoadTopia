import type { PrismaClient } from "@loadtopia/db";
import {
  type LoginInput,
  type RegisterInput,
  type MembershipView,
  type PublicUser,
  roleForCompanyType,
} from "@loadtopia/shared";
import { permissionsForRole } from "@loadtopia/domain";
import { conflict, unauthorized } from "../../lib/errors";
import { type Argon2Params, hashPassword, verifyPassword } from "../../lib/password";
import { generateSessionToken, hashSessionToken, sessionExpiry } from "../../lib/session";

export interface SessionContext {
  ip: string;
  userAgent: string | null;
}

export interface AuthResult {
  user: PublicUser;
  memberships: MembershipView[];
  permissions: string[];
  /** Raw session token — set as an httpOnly cookie by the caller, never logged. */
  token: string;
  expiresAt: Date;
}

function toPublicUser(u: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: Date;
}): PublicUser {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    createdAt: u.createdAt.toISOString(),
  };
}

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly argon: Argon2Params,
    private readonly sessionTtlHours: number,
  ) {}

  async register(input: RegisterInput, ctx: SessionContext): Promise<AuthResult> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw conflict("An account with that email already exists");

    const passwordHash = await hashPassword(input.password, this.argon);
    const role = roleForCompanyType(input.companyType);

    const { user, memberships } = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: { type: input.companyType, name: input.companyName },
      });
      const user = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          memberships: { create: { companyId: company.id, role, isPrimary: true } },
        },
      });
      const memberships: MembershipView[] = [
        {
          companyId: company.id,
          companyName: company.name,
          companyType: company.type,
          role,
          isPrimary: true,
        },
      ];
      return { user, memberships };
    });

    const session = await this.issueSession(user.id, ctx);
    return {
      user: toPublicUser(user),
      memberships,
      permissions: [...permissionsForRole(role)],
      token: session.token,
      expiresAt: session.expiresAt,
    };
  }

  async login(input: LoginInput, ctx: SessionContext): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { memberships: { include: { company: true }, orderBy: { isPrimary: "desc" } } },
    });

    // Uniform failure regardless of whether the email exists or the password is
    // wrong — still run a hash verification to keep timing consistent.
    const ok = user
      ? await verifyPassword(user.passwordHash, input.password)
      : await verifyPassword("$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", input.password);

    if (!user || !ok || !user.isActive) throw unauthorized("Invalid email or password");

    const memberships: MembershipView[] = user.memberships.map((m) => ({
      companyId: m.companyId,
      companyName: m.company.name,
      companyType: m.company.type,
      role: m.role,
      isPrimary: m.isPrimary,
    }));
    const role = memberships[0]?.role ?? "ADMIN";

    const session = await this.issueSession(user.id, ctx);
    return {
      user: toPublicUser(user),
      memberships,
      permissions: [...permissionsForRole(role)],
      token: session.token,
      expiresAt: session.expiresAt,
    };
  }

  async logout(tokenHash: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueSession(userId: string, ctx: SessionContext) {
    const token = generateSessionToken();
    const expiresAt = sessionExpiry(this.sessionTtlHours);
    await this.prisma.session.create({
      data: {
        userId,
        tokenHash: hashSessionToken(token),
        expiresAt,
        ip: ctx.ip,
        userAgent: ctx.userAgent?.slice(0, 512) ?? null,
      },
    });
    return { token, expiresAt };
  }
}
