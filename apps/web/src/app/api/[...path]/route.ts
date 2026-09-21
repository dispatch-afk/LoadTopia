import "server-only";
import { proxyApiRequest } from "@/lib/api-proxy";

// Milestone 4 release correction (P1-4 residual fix): every browser call to
// `/api/*` (via `apiClient()`) lands here and is proxied to the real API at
// genuine request time — see `api-proxy.ts` for the actual forwarding logic
// and `api-origin.mjs`'s `getApiOrigin()` for the strict runtime origin
// resolution this replaces the old build-time `next.config.mjs` rewrite
// with. `force-dynamic` guarantees Next never attempts to cache or
// statically optimize this route regardless of what any individual request
// looks like — every request here is per-session, per-cookie state.
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };

async function handle(request: Request, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  return proxyApiRequest(request, path);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
