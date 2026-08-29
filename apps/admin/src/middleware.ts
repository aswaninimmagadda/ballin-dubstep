import { NextResponse, type NextRequest } from 'next/server';

/**
 * Stamp every request with an id and echo it back on the response.
 *
 * This is the thread that makes a support call answerable: the reference in
 * the error a member was shown, the line in the application log, and the
 * entry in the reverse proxy's access log are all the same string.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function middleware(req: NextRequest): NextResponse {
  // A proxy in front of us may already have assigned one; keep it so the two
  // logs line up. It is client-controllable, so only accept a plausible id —
  // otherwise a caller could write newlines and punctuation into our logs.
  const inbound = req.headers.get('x-request-id');
  const id = inbound && SAFE_ID.test(inbound) ? inbound : crypto.randomUUID();

  const forwarded = new Headers(req.headers);
  forwarded.set('x-request-id', id);
  const res = NextResponse.next({ request: { headers: forwarded } });
  res.headers.set('x-request-id', id);
  return res;
}

export const config = {
  // Static assets and the image optimiser generate no support calls.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest).*)'],
};
