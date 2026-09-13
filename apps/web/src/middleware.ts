import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? "loadtopia_session";
// Includes /marketplace and /network — both were previously missing here
// (a pre-existing gap for /marketplace, flagged in the M4 frontend audit;
// fixed alongside adding /network since it's the same one-line list). Real
// session validation still happens server-side in the app layout regardless
// — this is only a fast redirect to skip rendering the shell for a
// definitely-signed-out visitor.
const PROTECTED = ["/dashboard", "/loads", "/marketplace", "/network", "/locations", "/equipment", "/settings"];

/**
 * Fast cookie-presence gate to avoid rendering the app shell for signed-out
 * users. Real session validation happens server-side in the app layout.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const needsAuth = PROTECTED.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (needsAuth && !req.cookies.get(SESSION_COOKIE)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/loads/:path*",
    "/marketplace/:path*",
    "/network/:path*",
    "/locations/:path*",
    "/equipment/:path*",
    "/settings/:path*",
  ],
};
