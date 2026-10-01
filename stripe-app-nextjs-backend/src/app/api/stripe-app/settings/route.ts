// /api/stripe-app/settings — STRIPE APP SIGNATURE auth.
//
//   GET    Both settings rows for the calling Stripe account + Dashboard
//          user in the mode named by the `stripe-mode` header, merged over
//          the defaults. This is the payload the Stripe App's useSettings
//          hook renders.
//
//   PATCH  Body: { scope: 'user' | 'account', settings: { key: value | null } }.
//          Merges the keys into that scope's row for the current mode (null
//          forgets a key so its default applies again) and answers with the
//          same payload as GET, so the app can replace its state in one step.
//
// Identity comes entirely from the signature: the proxy verified that
// stripe-account-id and stripe-user-id are what the app signed, and those
// two ids are the owners of the settings rows. No app login is needed —
// settings work from the first signed request after installation. (Who may
// change account-wide settings is not gated here: every Dashboard user of
// the account can. Tie it to a role if your app needs that, e.g. via the
// memberships table once users have logged in.)
//
// Test mode and live mode are different rows (the tables' primary key ends
// in livemode); the same two endpoints serve both.
//
// See src/lib/settings.ts (database) and src/types/settings.ts (the model).

import { NextRequest, NextResponse } from 'next/server';
import { AUTH_HEADERS } from '@/lib/proxy-auth';
import {
  loadSettings,
  modeFromHeader,
  patchStoredSettings,
  type SettingsOwner,
} from '@/lib/settings';
import { normalizeStripeUserId } from '@/lib/stripe-app-session';
import { validatePatch } from '@/types/settings';

/**
 * The checks every settings request shares. Returns the owner the request
 * is about, or the error response to send instead.
 */
function authenticate(req: NextRequest): SettingsOwner | NextResponse {
  // Defense in depth: confirm the proxy verified the Stripe App signature.
  if (req.headers.get(AUTH_HEADERS.stripeVerified) !== 'true') {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Stripe signature not verified' },
      { status: 401 },
    );
  }

  // Trustworthy: covered by the signature the proxy verified.
  const stripeAccountId = req.headers.get('stripe-account-id');
  if (!stripeAccountId) {
    return NextResponse.json(
      { error: 'Bad request', message: 'Missing stripe-account-id' },
      { status: 400 },
    );
  }

  return {
    stripeAccountId,
    // usr_… when a Dashboard user made the request (signed), '' otherwise.
    stripeUserId: normalizeStripeUserId(req.headers.get('stripe-user-id')),
    // Not signed, but the app is the only caller and it can only ever hurt
    // its own account by lying about the mode. Missing header → test.
    mode: modeFromHeader(req.headers.get('stripe-mode')),
  };
}

export async function GET(req: NextRequest) {
  try {
    const owner = authenticate(req);
    if (owner instanceof NextResponse) return owner;

    return NextResponse.json(await loadSettings(owner));
  } catch (error) {
    console.error('Error loading settings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const owner = authenticate(req);
    if (owner instanceof NextResponse) return owner;

    const body = (await req.json().catch(() => ({}))) as {
      scope?: unknown;
      settings?: unknown;
    };
    if (body.scope !== 'user' && body.scope !== 'account') {
      return NextResponse.json(
        { error: 'Bad request', message: 'scope must be "user" or "account"' },
        { status: 400 },
      );
    }

    // Unknown keys, keys from the other scope and wrong-typed values are all
    // rejected here, so a jsonb column can only ever hold what
    // src/types/settings.ts describes.
    const validated = validatePatch(body.scope, body.settings);
    if (!validated.ok) {
      return NextResponse.json(
        { error: 'Bad request', message: validated.error },
        { status: 400 },
      );
    }

    await patchStoredSettings(body.scope, owner, validated.stored);

    return NextResponse.json(await loadSettings(owner));
  } catch (error) {
    console.error('Error saving settings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
