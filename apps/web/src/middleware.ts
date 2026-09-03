import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? "loadtopia_session";
const PROTECTED = ["/dashboard", "/loads", "/locations", "/equipment", "/settings"];

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
  matcher: ["/dashboard/:path*", "/loads/:path*", "/locations/:path*", "/equipment/:path*", "/settings/:path*"],
};
