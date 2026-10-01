// lib/settings.ts
//
// ============================================================================
//  App settings — reading and patching the two settings tables
// ============================================================================
//
// Settings live in two tables that setup.sql defines, one row per owner per
// mode:
//
//   account_settings   account scope — shared by everyone in the Stripe
//                      account; key (stripe_account_id, livemode)
//   user_settings      user scope — one Dashboard user's own; key
//                      (stripe_account_id, stripe_user_id, livemode)
//
// The owner ids are the ones the Stripe App signature vouches for
// (stripe-account-id and stripe-user-id — see src/lib/proxy-auth.ts), so
// settings are available on every signed request with no app login. The
// Better Auth login is a separate, optional step for things that need an
// account of their own, such as paying for the app.
//
// src/types/settings.ts (identical copy in the Stripe App) says which
// setting lives where and how the two are merged; this file is the database
// half. The route at /api/stripe-app/settings is a thin wrapper around it.
//
// Two things worth copying into your own app:
//
//   • Patches are merged INSIDE Postgres by settings_merge() (see setup.sql)
//     in a single upsert. Reading the row, merging in JavaScript and writing
//     it back — what Parcelcraft's backend does — loses updates when two
//     saves overlap, which happens as soon as a user flips two switches
//     quickly. A jsonb merge in SQL needs no locking and no retry.
//
//   • There is no cache. A settings read is one primary-key lookup per
//     table; Postgres answers in about a millisecond. A Redis layer in
//     front of that adds a second system to run, invalidate and debug, and
//     stale-settings bugs are the price of getting invalidation wrong.
//     Cache at the client (the useSettings hook keeps one copy in React
//     state for the life of the view) and let the database be the truth.
// ============================================================================

import { getSupabase } from './supabase';
import {
  resolveScope,
  resolveSettings,
  type SettingsResponse,
  type SettingsScope,
  type StoredSettings,
  type StripeMode,
} from '@/types/settings';

/** The `stripe-mode` header, normalized. Anything but 'live' is treated as test. */
export function modeFromHeader(header: string | null): StripeMode {
  return header === 'live' ? 'live' : 'test';
}

/** The signed identity a settings request is about. */
export type SettingsOwner = {
  /** acct_… — covered by the signature. */
  stripeAccountId: string;
  /** usr_…, or '' for Connect/platform callers without a Dashboard user. */
  stripeUserId: string;
  mode: StripeMode;
};

/**
 * Everything the app needs to render settings for one mode: both stored
 * rows and the merged result. Two primary-key lookups, run in parallel. A
 * row that doesn't exist yet (nothing saved in this mode) simply
 * contributes nothing.
 */
export async function loadSettings(owner: SettingsOwner): Promise<SettingsResponse> {
  const supabase = getSupabase();
  const livemode = owner.mode === 'live';

  const [userRow, accountRow] = await Promise.all([
    supabase
      .from('user_settings')
      .select('settings')
      .eq('stripe_account_id', owner.stripeAccountId)
      .eq('stripe_user_id', owner.stripeUserId)
      .eq('livemode', livemode)
      .maybeSingle<{ settings: StoredSettings }>(),
    supabase
      .from('account_settings')
      .select('settings')
      .eq('stripe_account_id', owner.stripeAccountId)
      .eq('livemode', livemode)
      .maybeSingle<{ settings: StoredSettings }>(),
  ]);
  if (userRow.error) throw userRow.error;
  if (accountRow.error) throw accountRow.error;

  const account = accountRow.data?.settings ?? {};
  const user = userRow.data?.settings ?? {};

  return {
    settings: resolveSettings(account, user),
    account: resolveScope(account, 'account'),
    user: resolveScope(user, 'user'),
    mode: owner.mode,
  };
}

/**
 * Merge a validated patch (see validatePatch in src/types/settings.ts) into
 * one scope's row for the owner's mode, atomically, creating the row (and
 * the stripe_accounts row it hangs off) on the first save. Returns the
 * row's new value.
 */
export async function patchStoredSettings(
  scope: SettingsScope,
  owner: SettingsOwner,
  stored: StoredSettings,
): Promise<StoredSettings> {
  const supabase = getSupabase();
  const livemode = owner.mode === 'live';

  // Both functions are defined in setup.sql. supabase-js calls them through
  // PostgREST's RPC endpoint, in the schema the client is configured for.
  const { data, error } =
    scope === 'account'
      ? await supabase.rpc('patch_account_settings', {
          p_account_id: owner.stripeAccountId,
          p_livemode: livemode,
          p_patch: stored,
        })
      : await supabase.rpc('patch_user_settings', {
          p_account_id: owner.stripeAccountId,
          p_stripe_user_id: owner.stripeUserId,
          p_livemode: livemode,
          p_patch: stored,
        });
  if (error) throw error;
  return (data ?? {}) as StoredSettings;
}
