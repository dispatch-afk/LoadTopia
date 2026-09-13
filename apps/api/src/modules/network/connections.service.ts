import type { Prisma, PrismaClient } from "@loadtopia/db";
import {
  assertCompanyPrimaryAuthority,
  assertPermission,
  assertValidConnectionTransition,
  canonicalizeCompanyPair,
  canRespondToConnection,
  NetworkError,
  Permission,
} from "@loadtopia/domain";
import {
  type AuthenticatedActor,
  ConnectionEventType,
  ConnectionStatus,
  type ConnectionDetailView,
  type ConnectionEventView,
  type ConnectionView,
} from "@loadtopia/shared";
import { badRequest, notFound } from "../../lib/errors";

type Tx = Prisma.TransactionClient;

type ConnectionRow = Prisma.CompanyConnectionGetPayload<{
  include: { companyA: { select: { name: true } }; companyB: { select: { name: true } } };
}>;

function toView(row: ConnectionRow, myCompanyId: string): ConnectionView {
  const counterpartCompanyId = row.companyAId === myCompanyId ? row.companyBId : row.companyAId;
  const counterpartCompanyName =
    row.companyAId === myCompanyId ? row.companyB.name : row.companyA.name;
  return {
    id: row.id,
    companyAId: row.companyAId,
    companyBId: row.companyBId,
    counterpartCompanyId,
    counterpartCompanyName,
    status: row.status,
    requesterCompanyId: row.requesterCompanyId,
    awaitingMyResponse: row.status === ConnectionStatus.PENDING && row.requesterCompanyId !== myCompanyId,
    requestedAt: row.requestedAt.toISOString(),
    respondedAt: row.respondedAt?.toISOString() ?? null,
    disconnectedAt: row.disconnectedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const include = {
  companyA: { select: { name: true } },
  companyB: { select: { name: true } },
} satisfies Prisma.CompanyConnectionInclude;

/**
 * Company-to-company Connection lifecycle. ONE row per canonical pair for
 * the life of that pair (see the schema doc comment on CompanyConnection) —
 * a request/accept/decline/disconnect/re-request cycle all mutate that same
 * row; the full truthful history lives in the immutable
 * CompanyConnectionEvent log.
 *
 * Authorization: any active member holding {@link Permission.NETWORK_REQUEST}
 * may request a Connection or read their own company's connections;
 * accepting/declining/disconnecting additionally requires
 * {@link Permission.NETWORK_MANAGE} AND company-primary/admin authority
 * (`assertCompanyPrimaryAuthority`) — enforced here, not by a hidden UI
 * button.
 */
export class ConnectionsService {
  constructor(private readonly prisma: PrismaClient) {}

  private async lockPair(tx: Tx, companyAId: string, companyBId: string): Promise<void> {
    // Advisory lock keyed by the canonical pair — serializes even the very
    // first request between two companies, when no row exists yet to take a
    // row-level lock on (`SELECT ... FOR UPDATE` cannot lock a row that
    // doesn't exist; an advisory lock has no such requirement).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${companyAId} || ${companyBId}))`;
  }

  private async lockRow(tx: Tx, connectionId: string): Promise<void> {
    await tx.$executeRaw`SELECT 1 FROM company_connections WHERE id = ${connectionId}::uuid FOR UPDATE`;
  }

  async request(actor: AuthenticatedActor, targetCompanyId: string): Promise<ConnectionView> {
    assertPermission(actor, Permission.NETWORK_REQUEST);
    const myCompanyId = actor.companyId!;
    if (targetCompanyId === myCompanyId) throw badRequest("A company cannot connect to itself");

    const target = await this.prisma.company.findUnique({ where: { id: targetCompanyId } });
    if (!target) throw notFound("Company not found");

    const pair = canonicalizeCompanyPair(myCompanyId, targetCompanyId);
    const now = new Date();

    const row = await this.prisma.$transaction(async (tx) => {
      await this.lockPair(tx, pair.companyAId, pair.companyBId);

      const existing = await tx.companyConnection.findUnique({
        where: { companyAId_companyBId: { companyAId: pair.companyAId, companyBId: pair.companyBId } },
        include,
      });

      if (!existing) {
        assertValidConnectionTransition(null, "REQUEST");
        const created = await tx.companyConnection.create({
          data: {
            companyAId: pair.companyAId,
            companyBId: pair.companyBId,
            status: ConnectionStatus.PENDING,
            requesterCompanyId: myCompanyId,
            requestedByUserId: actor.userId,
            requestedAt: now,
          },
          include,
        });
        await tx.companyConnectionEvent.create({
          data: {
            connectionId: created.id,
            type: ConnectionEventType.REQUESTED,
            actorUserId: actor.userId,
            actorCompanyId: myCompanyId,
          },
        });
        return created;
      }

      if (existing.status === ConnectionStatus.ACCEPTED) {
        throw new NetworkError("These companies are already connected");
      }
      if (existing.status === ConnectionStatus.PENDING) {
        if (existing.requesterCompanyId === myCompanyId) {
          return existing; // idempotent — same-side re-request is a no-op
        }
        throw new NetworkError(
          "A connection request is already pending from that company — respond to it instead of requesting again",
        );
      }

      // DECLINED or DISCONNECTED: a legitimate re-request.
      assertValidConnectionTransition(existing.status, "REQUEST");
      const updated = await tx.companyConnection.update({
        where: { id: existing.id },
        data: {
          status: ConnectionStatus.PENDING,
          requesterCompanyId: myCompanyId,
          requestedByUserId: actor.userId,
          requestedAt: now,
          respondedByUserId: null,
          respondedAt: null,
          disconnectedAt: null,
        },
        include,
      });
      await tx.companyConnectionEvent.create({
        data: {
          connectionId: updated.id,
          type: ConnectionEventType.REQUESTED,
          actorUserId: actor.userId,
          actorCompanyId: myCompanyId,
        },
      });
      return updated;
    });

    return toView(row, myCompanyId);
  }

  private async respond(
    actor: AuthenticatedActor,
    connectionId: string,
    action: "ACCEPT" | "DECLINE",
  ): Promise<ConnectionView> {
    assertPermission(actor, Permission.NETWORK_MANAGE);
    assertCompanyPrimaryAuthority(actor);
    const myCompanyId = actor.companyId!;

    const row = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.companyConnection.findUnique({ where: { id: connectionId } });
      if (!existing) throw notFound("Connection not found");
      if (existing.companyAId !== myCompanyId && existing.companyBId !== myCompanyId) {
        throw notFound("Connection not found");
      }
      await this.lockRow(tx, connectionId);
      const fresh = await tx.companyConnection.findUniqueOrThrow({ where: { id: connectionId } });

      if (!canRespondToConnection(myCompanyId, fresh.requesterCompanyId)) {
        throw new NetworkError("Only the company that received the request may respond to it", 403);
      }
      const newStatus = assertValidConnectionTransition(fresh.status, action);
      const now = new Date();
      const updated = await tx.companyConnection.update({
        where: { id: connectionId },
        data: { status: newStatus, respondedByUserId: actor.userId, respondedAt: now },
        include,
      });
      await tx.companyConnectionEvent.create({
        data: {
          connectionId,
          type: action === "ACCEPT" ? ConnectionEventType.ACCEPTED : ConnectionEventType.DECLINED,
          actorUserId: actor.userId,
          actorCompanyId: myCompanyId,
        },
      });
      return updated;
    });

    return toView(row, myCompanyId);
  }

  accept(actor: AuthenticatedActor, connectionId: string): Promise<ConnectionView> {
    return this.respond(actor, connectionId, "ACCEPT");
  }

  decline(actor: AuthenticatedActor, connectionId: string): Promise<ConnectionView> {
    return this.respond(actor, connectionId, "DECLINE");
  }

  async disconnect(actor: AuthenticatedActor, connectionId: string): Promise<ConnectionView> {
    assertPermission(actor, Permission.NETWORK_MANAGE);
    assertCompanyPrimaryAuthority(actor);
    const myCompanyId = actor.companyId!;

    const row = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.companyConnection.findUnique({ where: { id: connectionId } });
      if (!existing) throw notFound("Connection not found");
      if (existing.companyAId !== myCompanyId && existing.companyBId !== myCompanyId) {
        throw notFound("Connection not found");
      }
      await this.lockRow(tx, connectionId);
      const fresh = await tx.companyConnection.findUniqueOrThrow({ where: { id: connectionId } });

      const newStatus = assertValidConnectionTransition(fresh.status, "DISCONNECT");
      const now = new Date();
      const updated = await tx.companyConnection.update({
        where: { id: connectionId },
        data: { status: newStatus, disconnectedAt: now },
        include,
      });
      await tx.companyConnectionEvent.create({
        data: {
          connectionId,
          type: ConnectionEventType.DISCONNECTED,
          actorUserId: actor.userId,
          actorCompanyId: myCompanyId,
        },
      });
      return updated;
    });

    return toView(row, myCompanyId);
  }

  /** Any active member may READ their own company's connections — reading
   *  is not gated behind company-primary/admin authority, only managing is. */
  async list(actor: AuthenticatedActor): Promise<ConnectionView[]> {
    assertPermission(actor, Permission.NETWORK_REQUEST);
    const myCompanyId = actor.companyId!;
    const rows = await this.prisma.companyConnection.findMany({
      where: { OR: [{ companyAId: myCompanyId }, { companyBId: myCompanyId }] },
      include,
      orderBy: { updatedAt: "desc" },
    });
    return rows.map((r) => toView(r, myCompanyId));
  }

  async getById(actor: AuthenticatedActor, connectionId: string): Promise<ConnectionDetailView> {
    assertPermission(actor, Permission.NETWORK_REQUEST);
    const myCompanyId = actor.companyId!;
    const row = await this.prisma.companyConnection.findUnique({
      where: { id: connectionId },
      include,
    });
    if (!row || (row.companyAId !== myCompanyId && row.companyBId !== myCompanyId)) {
      throw notFound("Connection not found");
    }
    const events = await this.prisma.companyConnectionEvent.findMany({
      where: { connectionId },
      orderBy: { createdAt: "asc" },
    });
    const eventViews: ConnectionEventView[] = events.map((e) => ({
      id: e.id,
      type: e.type,
      actorCompanyId: e.actorCompanyId,
      createdAt: e.createdAt.toISOString(),
    }));
    return { ...toView(row, myCompanyId), events: eventViews };
  }
}
