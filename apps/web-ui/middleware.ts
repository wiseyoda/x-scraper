/**
 * Stamps two cookies on every page load:
 *   - xs_last_visit  → carries forward to the next request
 *   - (header) x-xs-prev-visit → snapshot of the PREVIOUS value, exposed
 *     to server components so the dashboard can compute "since you last
 *     visited" without needing to write cookies itself (Next.js 15
 *     forbids cookie writes from server components).
 *
 * The flip happens here so each page render sees the prior visit's
 * timestamp, not its own.
 */

import { NextResponse, type NextRequest } from 'next/server';

const COOKIE_NAME = 'xs_last_visit';
const HEADER_NAME = 'x-xs-prev-visit';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export const config = {
  // Stamp on user-facing routes; skip Next.js internals, static, and
  // image optimizer. Matcher follows the canonical Next.js 15 pattern.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};

export function middleware(req: NextRequest): NextResponse {
  const prev = req.cookies.get(COOKIE_NAME)?.value ?? '';
  const requestHeaders = new Headers(req.headers);
  if (prev.length > 0) requestHeaders.set(HEADER_NAME, prev);

  const res = NextResponse.next({
    request: { headers: requestHeaders },
  });
  res.cookies.set(COOKIE_NAME, new Date().toISOString(), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: ONE_YEAR_SECONDS,
    path: '/',
  });
  return res;
}
