import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

/** Application-level error with an HTTP status and a stable machine code. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new AppError(400, "BAD_REQUEST", msg, details);
export const unauthorized = (msg = "Authentication required") =>
  new AppError(401, "UNAUTHORIZED", msg);
export const forbidden = (msg = "You do not have permission to perform this action") =>
  new AppError(403, "FORBIDDEN", msg);
export const notFound = (msg = "Resource not found") => new AppError(404, "NOT_FOUND", msg);
export const conflict = (msg: string) => new AppError(409, "CONFLICT", msg);

const DOMAIN_ERROR_CODES = new Set([
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "INVALID_LOAD_TRANSITION",
  "COMPANY_CONTEXT",
  // Marketplace domain errors (@loadtopia/domain marketplace/*). Each carries a
  // numeric statusCode; the handler below trusts it (default 409 for the
  // transition error, which mirrors INVALID_LOAD_TRANSITION).
  "NEGOTIATION_RULE",
  "INVALID_OFFER_TRANSITION",
]);

function isDomainError(
  error: unknown,
): error is { code: string; message: string; statusCode?: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    DOMAIN_ERROR_CODES.has((error as { code: string }).code)
  );
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: `Route ${request.method} ${request.url} not found`,
        requestId: request.id,
      },
    });
  });

  app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;

    if (error instanceof ZodError) {
      request.log.info({ requestId, issues: error.issues }, "request validation failed");
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          requestId,
          details: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      });
    }

    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        request.log.error({ requestId, err: error }, error.message);
      } else {
        request.log.info({ requestId, code: error.code }, error.message);
      }
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, requestId, details: error.details },
      });
    }

    // Domain errors (@loadtopia/domain) carry a stable `code` and, usually, a
    // `statusCode`. They are framework-free so they are duck-typed here rather
    // than imported. `LoadTransitionError` has no statusCode → treat as 409.
    if (isDomainError(error)) {
      const status =
        typeof error.statusCode === "number"
          ? error.statusCode
          : error.code === "INVALID_LOAD_TRANSITION"
            ? 409
            : 400;
      const details =
        "issues" in error && Array.isArray((error as { issues?: unknown[] }).issues)
          ? (error as { issues: unknown[] }).issues
          : undefined;
      request.log.info({ requestId, code: error.code }, error.message);
      return reply.status(status).send({
        error: { code: error.code, message: error.message, requestId, details },
      });
    }

    // Fastify's own errors (e.g. rate limit 429, body parse 400) carry statusCode.
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status < 500) {
      return reply.status(status).send({
        error: {
          code: (error as { code?: string }).code ?? "REQUEST_ERROR",
          message: (error as Error).message ?? "Request error",
          requestId,
        },
      });
    }

    request.log.error({ requestId, err: error }, "unhandled error");
    return reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred", requestId },
    });
  });
}
