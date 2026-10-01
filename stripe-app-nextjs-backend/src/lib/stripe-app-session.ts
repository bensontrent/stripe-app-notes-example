// lib/stripe-app-session.ts
//
// ============================================================================
//  Stripe App login — linking a dashboard user to a Better Auth user
// ============================================================================
//
// A Stripe App UI extension can't set cookies or open a login form of its
// own, so "logging in" works as a handshake between the app and the browser
// (the same pattern Stripe's docs and Parcelcraft use):
//
//   1. The app mints a random `state` key and opens /stripe?state=… in a
//      browser tab. The user logs in there with Better Auth as usual.
//   2. The /stripe page posts the state back (cookie-authenticated), which
//      stores state → user as a row in the verifications table (15-minute
//      TTL). That table is Better Auth's generic short-lived key/value
//      store — exactly what a login handshake needs, so no extra table.
//   3. Meanwhile the app polls /api/stripe-app/verify?state=… with signed
//      requests. Once the state row exists, claimLoginState() moves the
//      link into stripe_app_sessions — keyed by the *signed* (and therefore
//      trustworthy) stripe-account-id / stripe-user-id headers — and the
//      poll returns 200.
//   4. From then on /api/stripe-app/userinfo resolves the dashboard user to
//      the app user on every signed request. Logout deletes the row.
//
// The routes under /api/stripe-app/{session,verify,userinfo} are thin HTTP
// wrappers around these helpers.

import { getSupabase } from './supabase';

/** How long the browser has to finish logging in after the app opens the tab. */
const LOGIN_STATE_TTL_MS = 15 * 60 * 1000;

/** Namespaces our rows in the shared verifications table. */
const LOGIN_STATE_PREFIX = 'stripe-app-login:';

/** State keys are minted by the app as UUIDs; be strict about what we store. */
export function isValidStateKey(state: unknown): state is string {
  return typeof state === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(state);
}

/**
 * Normalize the stripe-user-id header for use in the session key. Dashboard
 * users have a usr_… id; Connect/platform callers don't send one (and only
 * the account id is covered by the signature), so they share the '' slot.
 */
export function normalizeStripeUserId(stripeUserId: string | null): string {
  return stripeUserId && stripeUserId.includes('usr_') ? stripeUserId : '';
}

export type StripeAppUser = {
  userId: string;
  email: string;
  name: string | null;
};

/**
 * Step 2: the /stripe page (browser, cookie-authenticated) stores
 * state → user so the app's polling can find it.
 */
export async function createLoginState(
  state: string,
  userId: string,
): Promise<void> {
  const supabase = getSupabase();
  const identifier = LOGIN_STATE_PREFIX + state;

  // Opportunistically clear out abandoned handshakes (ours only — this is
  // Better Auth's table too, so always filter on the prefix).
  await supabase
    .from('verifications')
    .delete()
    .like('identifier', `${LOGIN_STATE_PREFIX}%`)
    .lt('expires_at', new Date().toISOString());

  // Delete-then-insert rather than upsert: verifications has no unique
  // constraint on identifier.
  await supabase.from('verifications').delete().eq('identifier', identifier);
  const { error } = await supabase.from('verifications').insert({
    identifier,
    value: userId,
    expires_at: new Date(Date.now() + LOGIN_STATE_TTL_MS).toISOString(),
  });
  if (error) throw error;
}

/**
 * Step 3: a signed poll from the app claims the state row. Returns false
 * until the browser login has completed (or after the state expired). On
 * success the state row is consumed and the stripe_app_sessions link (plus
 * a membership) is created.
 */
export async function claimLoginState(
  state: string,
  stripeAccountId: string,
  stripeUserId: string,
): Promise<boolean> {
  const supabase = getSupabase();
  const identifier = LOGIN_STATE_PREFIX + state;

  const { data: row, error } = await supabase
    .from('verifications')
    .select('value')
    .eq('identifier', identifier)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle<{ value: string }>();
  if (error) throw error;
  if (!row) return false;

  const { error: sessionError } = await supabase
    .from('stripe_app_sessions')
    .upsert(
      {
        stripe_account_id: stripeAccountId,
        stripe_user_id: normalizeStripeUserId(stripeUserId),
        user_id: row.value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'stripe_account_id,stripe_user_id' },
    );
  if (sessionError) throw sessionError;

  // Logging in from inside the dashboard proves the user works in this
  // Stripe account, so record the membership too (same first-registrant-
  // becomes-owner convention as /api/protected/stripe-app).
  await ensureMembership(stripeAccountId, row.value);

  // The handshake is one-shot: consume the state so it can't be replayed.
  await supabase.from('verifications').delete().eq('identifier', identifier);

  return true;
}

/**
 * Step 4: resolve the (signed) dashboard identity to the logged-in app user.
 * Returns null when nobody is logged in for that identity.
 */
export async function getAppUser(
  stripeAccountId: string,
  stripeUserId: string,
): Promise<StripeAppUser | null> {
  const supabase = getSupabase();

  // users(...) follows the FK from stripe_app_sessions like a join; without
  // generated database types, spell the embed's shape out for supabase-js.
  const { data, error } = await supabase
    .from('stripe_app_sessions')
    .select('user_id, users ( email, name )')
    .eq('stripe_account_id', stripeAccountId)
    .eq('stripe_user_id', normalizeStripeUserId(stripeUserId))
    .maybeSingle<{
      user_id: string;
      users: { email: string; name: string | null } | null;
    }>();
  if (error) throw error;
  if (!data?.users) return null;

  return {
    userId: data.user_id,
    email: data.users.email,
    name: data.users.name,
  };
}

/** App logout: forget the link. Idempotent. */
export async function deleteAppSession(
  stripeAccountId: string,
  stripeUserId: string,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('stripe_app_sessions')
    .delete()
    .eq('stripe_account_id', stripeAccountId)
    .eq('stripe_user_id', normalizeStripeUserId(stripeUserId));
  if (error) throw error;
}

async function ensureMembership(
  stripeAccountId: string,
  userId: string,
): Promise<void> {
  const supabase = getSupabase();

  // The account row must exist before a membership can reference it. Writing
  // only the id keeps an existing row's name/settings/installation ids.
  const { error: accountError } = await supabase
    .from('stripe_accounts')
    .upsert({ id: stripeAccountId }, { onConflict: 'id', ignoreDuplicates: true });
  if (accountError) throw accountError;

  const { count, error: countError } = await supabase
    .from('memberships')
    .select('*', { count: 'exact', head: true })
    .eq('stripe_account_id', stripeAccountId);
  if (countError) throw countError;

  // ignoreDuplicates = ON CONFLICT DO NOTHING: an existing membership keeps
  // its role.
  const { error: memberError } = await supabase.from('memberships').upsert(
    {
      stripe_account_id: stripeAccountId,
      user_id: userId,
      role: count === 0 ? 'owner' : 'member',
    },
    { onConflict: 'stripe_account_id,user_id', ignoreDuplicates: true },
  );
  if (memberError) throw memberError;
}
