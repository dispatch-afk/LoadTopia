import "server-only";
import { cookies } from "next/headers";
import type { ApiErrorBody } from "@loadtopia/shared";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:4000";
const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? "loadtopia_session";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Server-side fetch to the API, forwarding the caller's session cookie. */
export async function apiServer<T>(
  path: string,
  init: RequestInit & { query?: Record<string, string | number | undefined> } = {},
): Promise<T> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  const url = new URL(`${API_ORIGIN}${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });

  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (body as ApiErrorBody).error;
    throw new ApiError(res.status, e?.code ?? "ERROR", e?.message ?? res.statusText, e?.details);
  }
  return body as T;
}
