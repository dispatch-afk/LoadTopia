import type { PrismaClient } from "@loadtopia/db";
import type { FastifyRequest } from "fastify";

/**
 * Append-only security audit trail. Failures to write an audit row are logged
 * but never block the underlying request.
 */
export interface AuditEntry {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  data?: Record<string, unknown> | null;
}

export async function writeAudit(
  prisma: PrismaClient,
  request: FastifyRequest,
  entry: AuditEntry,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: entry.actorUserId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        ip: request.ip,
        userAgent: request.headers["user-agent"]?.slice(0, 512) ?? null,
        data: (entry.data ?? undefined) as never,
      },
    });
  } catch (err) {
    request.log.error({ err, action: entry.action }, "failed to write audit log");
  }
}
