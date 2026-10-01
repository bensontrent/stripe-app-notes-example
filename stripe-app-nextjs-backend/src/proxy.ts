// src/proxy.ts
//
// ============================================================================
//  The authentication proxy — every request passes through here first
// ============================================================================
//
// Next.js 16 calls this file the "proxy" (it was `middleware.ts` in earlier
// versions). It runs on the Node.js runtime before any route handler or
// page, which makes it the single place to sort requests into auth flavors:
//
//   ┌─ OPTIONS preflight ────────► 204 + CORS headers, no auth
//   ├─ PUBLIC_ROUTES ────────────► pass through; the ROUTE verifies:
//   │                                • /api/webhooks/* — Stripe webhook
//   │                                  signature (constructEvent); the two
//   │                                  routes are in src/pages/api/webhooks
//   │                                • /api/auth/* — Better Auth's own
//   │                                  endpoints (cookies + CSRF)
//   ├─ Stripe App headers ───────► verify `stripe-signature` HMAC here,
//   │                              then forward with x-auth-type set
//   ├─ Authorization: Bearer ────► verify against, in order:
//   │                                • BEARER_TOKEN_KEYS / CRON_SECRET
//   │                                • DEV_API_KEY (NODE_ENV=development only)
//   │                                • user API keys in the DB (future work)
//   └─ everything else ──────────► Better Auth session cookie:
//                                    • pages: redirect to /login
//                                    • /api/*: 401 JSON
//
// The verified-by-proxy markers (`x-auth-type`, `x-stripe-verified`) are
// stripped from every incoming request before any branch runs, so a client
// can never spoof them. Route handlers can trust them — see
// src/lib/proxy-auth.ts for the helpers and header names.
// ============================================================================

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  AUTH_HEADERS,
  corsPreflightResponse,
  getBearerToken,
  hasStripeAppHeaders,
  jsonError,
  verifyApiKey,
  verifyStripeAppSignature,
  withCors,
} from './lib/proxy-auth';

// ---------------------------------------------------------------------------
//  Route tables — edit these to change what's public / key-gated
// ---------------------------------------------------------------------------

/**
 * Prefixes that bypass proxy authentication entirely. Each one is either
 * genuinely public or authenticates AT THE ROUTE LEVEL (noted inline).
 */
const PUBLIC_ROUTES = [
  '/docs', // public documentation (rendered from src/content/docs)
  '/plans', // public price list (reads nothing about the visitor)
  '/login', // sign-in page
  '/register', // sign-up page
  '/reset-password', // request a password-reset email
  '/confirm', // password-reset landing page (token arrives in the URL)
  '/stripe-logout', // Stripe App logout landing page
  '/end-session', // generic sign-out page
  '/api/auth', // Better Auth handles its own auth (cookies, CSRF)
  '/api/webhooks', // routes verify the Stripe webhook signature (app + billing)
];

/** Pages that are public on exact match only. */
const PUBLIC_PAGES = ['/'];

/**
 * API prefixes that REQUIRE an API key (no session fallback). Anything
 * calling these must send `Authorization: Bearer <key>` — e.g. Vercel cron
 * jobs, which send CRON_SECRET when it is set. Empty today: this app has no
 * scheduled jobs. Add '/api/cron' here when it gets one.
 */
const BEARER_ONLY_ROUTES: string[] = [];

// ---------------------------------------------------------------------------
//  The proxy
// ---------------------------------------------------------------------------

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Strip the proxy's own auth markers off the incoming request so clients
  // can't spoof them. These cleaned headers are forwarded on every branch.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(AUTH_HEADERS.authType);
  requestHeaders.delete(AUTH_HEADERS.stripeVerified);

  const forward = () =>
    withCors(NextResponse.next({ request: { headers: requestHeaders } }));

  // --- CORS preflight: always allowed, never authenticated ----------------
  if (request.method === 'OPTIONS') {
    return corsPreflightResponse();
  }

  // --- Flavor 1: public routes (route-level auth) --------------------------
  const isPublic =
    PUBLIC_PAGES.includes(pathname) ||
    PUBLIC_ROUTES.some((route) => pathname.startsWith(route));

  if (isPublic) {
    return forward();
  }

  // --- Flavor 2: Stripe App signed requests --------------------------------
  // Requests from the Stripe App UI extension carry stripe-signature +
  // stripe-account-id headers. Verify the HMAC here; on success the
  // stripe-* identity headers are trustworthy (they're what was signed).
  if (hasStripeAppHeaders(request)) {
    try {
      await verifyStripeAppSignature(request);
    } catch (error) {
      return jsonError(
        401,
        'Access denied',
        error instanceof Error ? error.message : 'Stripe authentication failed',
      );
    }

    requestHeaders.set(AUTH_HEADERS.authType, 'stripe-signature');
    requestHeaders.set(AUTH_HEADERS.stripeVerified, 'true');
    return forward();
  }

  // --- Flavors 3–5: API keys (bearer / dev key / user keys) ----------------
  const bearerToken = getBearerToken(request);
  const isBearerOnly = BEARER_ONLY_ROUTES.some((route) =>
    pathname.startsWith(route),
  );

  if (bearerToken) {
    const authType = await verifyApiKey(bearerToken);
    if (!authType) {
      return jsonError(403, 'Forbidden', 'Invalid API key');
    }

    requestHeaders.set(AUTH_HEADERS.authType, authType);
    return forward();
  }

  if (isBearerOnly) {
    return jsonError(
      401,
      'Unauthorized',
      'Missing or invalid authorization header',
    );
  }

  // --- Flavor 6: Better Auth session (browser traffic) ---------------------
  // Optimistic cookie check only — cheap and good enough for routing.
  // Route handlers and pages do the real verification with
  // `auth.api.getSession()` (see /api/protected/stripe-app for an example).
  const sessionToken = request.cookies.get('better-auth.session_token')?.value;

  if (!sessionToken) {
    if (pathname.startsWith('/api')) {
      return jsonError(401, 'Unauthorized', 'Authentication required');
    }

    const loginUrl = new URL('/login', request.url);
    // Keep the query string so e.g. /stripe?state=… survives the login
    // round-trip (the Stripe App login handshake depends on it).
    loginUrl.searchParams.set('redirect', pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  requestHeaders.set(AUTH_HEADERS.authType, 'session');
  return forward();
}

export const config = {
  matcher: [
    /*
     * Run the proxy on everything except:
     * - _next/static, _next/image (build assets)
     * - favicon.ico and other static files by extension
     * All /api routes ARE matched — the route tables above decide
     * which ones skip authentication.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)',
  ],
};
