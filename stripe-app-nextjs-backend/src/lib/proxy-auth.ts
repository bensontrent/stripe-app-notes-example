// lib/proxy-auth.ts
//
// ============================================================================
//  Authentication helpers for the Next.js proxy (src/proxy.ts)
// ============================================================================
//
// The proxy supports several "flavors" of authentication. Each helper here
// verifies one flavor; src/proxy.ts decides which one applies to a request.
//
//   1. Public routes        — skipped by the proxy entirely; the route handler
//                             does its own verification (Stripe webhook
//                             signatures).
//   2. Stripe App signature — requests from a Stripe App UI extension carry
//                             `stripe-signature` + `stripe-account-id`
//                             headers produced by `fetchStripeSignature()`.
//                             Verified against your app's signing secret
//                             (STRIPE_APP_SIGNING_SECRET) below.
//   3. Bearer tokens        — `Authorization: Bearer <key>` checked against
//                             BEARER_TOKEN_KEYS / CRON_SECRET env vars.
//   4. Local dev API key    — DEV_API_KEY, accepted ONLY when
//                             NODE_ENV=development. Handy for curl/Postman
//                             against `next dev` without a session.
//   5. User API keys        — future work: keys issued to users and checked
//                             against the database. Stubbed in verifyApiKey.
//   6. Better Auth session  — the fallback for everything else (browser
//                             traffic). The proxy does an optimistic cookie
//                             check; route handlers do the real
//                             `auth.api.getSession()` verification.
//
// After a successful verification the proxy forwards the request with
// `x-auth-type` (and `x-stripe-verified` for Stripe requests) set, so route
// handlers know how the caller was authenticated. The proxy strips those
// headers from every incoming request first — clients cannot spoof them.
// ============================================================================

import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';

// ---------------------------------------------------------------------------
//  Shared constants and types
// ---------------------------------------------------------------------------

/**
 * Headers the proxy sets after verifying a request. Route handlers read
 * these to learn how the caller authenticated. The proxy deletes them from
 * incoming requests before doing anything else, so their presence is proof
 * the proxy ran.
 */
export const AUTH_HEADERS = {
  /** Which auth flavor verified this request. */
  authType: 'x-auth-type',
  /** Set to 'true' when the Stripe App signature was verified. */
  stripeVerified: 'x-stripe-verified',
} as const;

export type ProxyAuthType =
  | 'session' // Better Auth session cookie (verified for real at the route)
  | 'stripe-signature' // Stripe App UI extension signed request
  | 'bearer-token' // key from BEARER_TOKEN_KEYS / CRON_SECRET
  | 'dev-api-key' // DEV_API_KEY, development mode only
  | 'user-api-key'; // future: per-user keys stored in the database

// ---------------------------------------------------------------------------
//  CORS
//
//  Stripe App UI extensions fetch from inside the Stripe Dashboard, so API
//  responses need permissive CORS headers, and preflight OPTIONS requests
//  must succeed without authentication.
// ---------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Requested-With, ' +
    'stripe-signature, stripe-user-id, stripe-account-id, stripe-email, ' +
    'stripe-mode, stripe-sandbox, stripe-type',
  'Access-Control-Max-Age': '86400',
};

/** Add CORS headers to an outgoing response (mutates and returns it). */
export function withCors<T extends NextResponse>(response: T): T {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

/** 204 response for CORS preflight (OPTIONS) requests. */
export function corsPreflightResponse(): NextResponse {
  return withCors(new NextResponse(null, { status: 204 }));
}

/** JSON error response with CORS headers, e.g. jsonError(401, 'Unauthorized', '...'). */
export function jsonError(
  status: number,
  error: string,
  message: string,
): NextResponse {
  return withCors(NextResponse.json({ error, message }, { status }));
}

// ---------------------------------------------------------------------------
//  Flavor 2: Stripe App signed requests
//
//  A Stripe App UI extension calls `fetchStripeSignature()` and sends the
//  result in a `stripe-signature` header alongside `stripe-user-id` and
//  `stripe-account-id`. The signature is an HMAC over a JSON payload of
//  those ids, keyed with your app's signing secret — the "Signing secret"
//  on your app's settings page in the Stripe Developers Dashboard.
//
//  Because the signed payload is rebuilt from the headers, tampering with
//  `stripe-account-id` (or `stripe-user-id`) makes verification fail —
//  route handlers can trust those headers once the proxy passes them on.
// ---------------------------------------------------------------------------

// Signature verification is pure HMAC math — it never calls the Stripe API —
// so this client deliberately gets a placeholder key. Use lib/stripe.ts when
// you need a real API client.
const stripeSignatureVerifier = new Stripe(
  'sk_placeholder_signature_verification_only',
);

/**
 * Does this look like a request from a Stripe App UI extension?
 * (Both headers are required for verification.)
 */
export function hasStripeAppHeaders(request: NextRequest): boolean {
  return Boolean(
    request.headers.get('stripe-signature') &&
    request.headers.get('stripe-account-id'),
  );
}

/**
 * Verify the `stripe-signature` header of a Stripe App request.
 * Throws with a descriptive message on failure.
 */
export async function verifyStripeAppSignature(
  request: NextRequest,
): Promise<void> {
  const signature = request.headers.get('stripe-signature');
  const userId = request.headers.get('stripe-user-id');
  const accountId = request.headers.get('stripe-account-id');

  if (!signature || !accountId) {
    throw new Error('Missing Stripe App identifiers');
  }

  const appSecret = process.env.STRIPE_APP_SIGNING_SECRET;
  if (!appSecret) {
    throw new Error('STRIPE_APP_SIGNING_SECRET is not configured');
  }

  // The signed payload must byte-for-byte match what the UI extension's
  // fetchStripeSignature() signed. Dashboard users have a `usr_...` id and
  // sign { user_id, account_id }; platform/Connect callers without a
  // dashboard user sign { account_id } only.
  const signedPayload =
    userId && userId.includes('usr_')
      ? JSON.stringify({ user_id: userId, account_id: accountId })
      : JSON.stringify({ account_id: accountId });

  try {
    await stripeSignatureVerifier.webhooks.signature.verifyHeaderAsync(
      signedPayload,
      signature,
      appSecret,
    );
  } catch (error) {
    console.warn('[proxy-auth] Stripe signature verification failed:', error);
    throw new Error('Invalid Stripe signature');
  }
}

// ---------------------------------------------------------------------------
//  Flavors 3–5: API keys (bearer tokens, dev key, user keys)
// ---------------------------------------------------------------------------

/** Constant-time string comparison to avoid leaking key contents via timing. */
function timingSafeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** Extract the token from an `Authorization: Bearer <token>` header. */
export function getBearerToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length);
}

/**
 * Check an API key against every key source, in order:
 *
 *   1. BEARER_TOKEN_KEYS (comma-separated) and CRON_SECRET env vars
 *      → 'bearer-token'
 *   2. DEV_API_KEY, accepted only when NODE_ENV=development
 *      → 'dev-api-key'
 *   3. User-issued API keys in the database (future work)
 *      → 'user-api-key'
 *
 * Returns the matching auth type, or null when nothing matched.
 */
export async function verifyApiKey(
  token: string,
): Promise<ProxyAuthType | null> {
  // 1. Static keys from the environment.
  const envKeys = (process.env.BEARER_TOKEN_KEYS ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);

  if (process.env.CRON_SECRET) {
    envKeys.push(process.env.CRON_SECRET);
  }

  if (envKeys.some((key) => timingSafeCompare(key, token))) {
    return 'bearer-token';
  }

  // 2. Local development key — never accepted outside `next dev`.
  if (
    process.env.NODE_ENV === 'development' &&
    process.env.DEV_API_KEY &&
    timingSafeCompare(process.env.DEV_API_KEY, token)
  ) {
    return 'dev-api-key';
  }

  // 3. TODO(future work): user API keys checked against the database.
  //    Sketch: add an `api_keys` table (a new file in migrations/) storing a
  //    SHA-256 hash of each issued key plus its user_id; hash `token` here,
  //    look it up via the Supabase client, and return 'user-api-key' with the
  //    owning user attached.

  return null;
}
