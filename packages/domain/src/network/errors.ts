/** A relationship-network business-rule violation (invalid connection
 *  transition, ineligible group membership, malformed pair, ...). Framework-
 *  free, duck-typed by the API error handler the same way marketplace domain
 *  errors are (see apps/api/src/lib/errors.ts's DOMAIN_ERROR_CODES). */
export class NetworkError extends Error {
  readonly code = "NETWORK_RULE";
  readonly statusCode: number;

  constructor(message: string, statusCode = 409) {
    super(message);
    this.name = "NetworkError";
    this.statusCode = statusCode;
  }
}
