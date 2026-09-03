"use client";

import type { ApiErrorBody } from "@loadtopia/shared";

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

/**
 * Client-side fetch. Always hits the same origin (`/api/...`) which Next
 * reverse-proxies to the API, so the session cookie is sent automatically.
 */
export async function apiClient<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
    credentials: "include",
  });

  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (body as ApiErrorBody).error;
    throw new ApiError(res.status, e?.code ?? "ERROR", e?.message ?? res.statusText, e?.details);
  }
  return body as T;
}

export function fieldErrors(err: unknown): Record<string, string> {
  if (
    err instanceof ApiError &&
    err.code === "VALIDATION_ERROR" &&
    Array.isArray(err.details)
  ) {
    const out: Record<string, string> = {};
    for (const d of err.details as Array<{ path?: string; message?: string }>) {
      if (d.path) out[d.path] = d.message ?? "invalid";
    }
    return out;
  }
  return {};
}
