import type { PrismaClient } from "@loadtopia/db";
import {
  type LoginInput,
  type MembershipView,
  type PublicUser,
  type RegisterInput,
  roleForCompanyType,
} from "@loadtopia/shared";
import { permissionsForRole } from "@loadtopia/domain";
import { generateUniqueLoadNumberPrefix } from "../../lib/company-prefix";
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
  activeCompanyId: string | null;
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

type MembershipRow = {
  id: string;
  companyId: string;
  role: MembershipView["role"];
  isPrimary: boolean;
  isActive: boolean;
  company: { name: string; type: MembershipView["companyType"] };
};

function toViews(rows: MembershipRow[]): MembershipView[] {
  return rows.map((m) => ({
    membershipId: m.id,
    companyId: m.companyId,
    companyName: m.company.name,
    companyType: m.company.type,
    role: m.role,
    isPrimary: m.isPrimary,
    isActive: m.isActive,
  }));
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

    const { user, membershipRows } = await this.prisma.$transaction(async (tx) => {
      const loadNumberPrefix = await generateUniqueLoadNumberPrefix(tx, input.companyName);
      const company = await tx.company.create({
        data: { type: input.companyType, name: input.companyName, loadNumberPrefix },
      });
      const user = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          memberships: {
            create: { companyId: company.id, role, isPrimary: true, isActive: true },
          },
        },
        include: { memberships: { include: { company: { select: { name: true, type: true } } } } },
      });
      return { user, membershipRows: user.memberships as MembershipRow[] };
    });

    const activeCompanyId = membershipRows[0]?.companyId ?? null;
    const session = await this.issueSession(user.id, activeCompanyId, ctx);
    return {
      user: toPublicUser(user),
      memberships: toViews(membershipRows),
      activeCompanyId,
      permissions: [...permissionsForRole(role)],
      token: session.token,
      expiresAt: session.expiresAt,
    };
  }

  async login(input: LoginInput, ctx: SessionContext): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: {
        memberships: {
          include: { company: { select: { name: true, type: true } } },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        },
      },
    });

    // Uniform failure regardless of whether the email exists or the password is
    // wrong — still run a hash verification to keep timing consistent.
    const ok = user
      ? await verifyPassword(user.passwordHash, input.password)
      : await verifyPassword(
          "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          input.password,
        );

    if (!user || !ok || !user.isActive) throw unauthorized("Invalid email or password");

    const rows = user.memberships as MembershipRow[];
    const views = toViews(rows);
    const firstActive = rows.find((m) => m.isActive) ?? null;
    const activeCompanyId = firstActive?.companyId ?? null;
    const role = firstActive?.role ?? "ADMIN";

    const session = await this.issueSession(user.id, activeCompanyId, ctx);
    return {
      user: toPublicUser(user),
      memberships: views,
      activeCompanyId,
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

  private async issueSession(userId: string, activeCompanyId: string | null, ctx: SessionContext) {
    const token = generateSessionToken();
    const expiresAt = sessionExpiry(this.sessionTtlHours);
    await this.prisma.session.create({
      data: {
        userId,
        tokenHash: hashSessionToken(token),
        activeCompanyId,
        expiresAt,
        ip: ctx.ip,
        userAgent: ctx.userAgent?.slice(0, 512) ?? null,
      },
    });
    return { token, expiresAt };
  }
}
