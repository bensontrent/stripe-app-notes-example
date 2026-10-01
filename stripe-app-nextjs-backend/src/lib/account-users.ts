// lib/account-users.ts
//
// ============================================================================
//  The team directory — who a task can be assigned to
// ============================================================================
//
// Stripe gives an app no list of an account's team members. What every signed
// request does carry is the Dashboard user making it (stripe-user-id, covered
// by the signature). So each time one of the app's views opens it "checks
// in" (POST /api/stripe-app/team), and the account_users table remembers
// everyone who ever did. That table is the assignee list, and where the
// assignment email finds an address.
//
// What is trustworthy here and what isn't:
//
//   • The ids are signed. A row can only be created for the Dashboard user
//     who is really making the request, in the account they are really in.
//   • name and email are reported by the app from the Dashboard's user
//     context. They are display data. Never use them to decide what someone
//     may do.
// ============================================================================

import type { SignedIdentity } from './signed-request';
import { getSupabase } from './supabase';
import type { TeamMember, TeamResponse } from '@/types/notes';

type AccountUserRow = {
  stripe_user_id: string;
  name: string | null;
  email: string | null;
  last_seen_at: string;
};

const ACCOUNT_USER_COLUMNS = 'stripe_user_id, name, email, last_seen_at';

const MAX_PROFILE_LENGTH = 200;
// Loose on purpose: enough to keep obvious junk out of the To: line. The
// email provider does the real validation.
const EMAIL_PATTERN = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

const toTeamMember = (row: AccountUserRow): TeamMember => ({
  id: row.stripe_user_id,
  name: row.name,
  email: row.email,
  lastSeenAt: row.last_seen_at,
});

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // Control characters have no business in a display name (or a mail header).
  const name = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return name.length === 0 ? null : name.slice(0, MAX_PROFILE_LENGTH);
}

function cleanEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim();
  if (email.length === 0 || email.length > MAX_PROFILE_LENGTH) return null;
  return EMAIL_PATTERN.test(email) ? email : null;
}

/**
 * The stripe_accounts row everything per-account hangs off. Created on
 * demand: the first signed request from a fresh install may arrive before
 * (or without) the install webhook. Writing only the id leaves an existing
 * row untouched.
 */
export async function ensureStripeAccount(stripeAccountId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('stripe_accounts')
    .upsert({ id: stripeAccountId }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw error;
}

/** Everyone who has opened the app in the account, most recently seen first. */
export async function listTeamMembers(stripeAccountId: string): Promise<TeamMember[]> {
  const { data, error } = await getSupabase()
    .from('account_users')
    .select(ACCOUNT_USER_COLUMNS)
    .eq('stripe_account_id', stripeAccountId)
    .order('last_seen_at', { ascending: false })
    .limit(500)
    .returns<AccountUserRow[]>();
  if (error) throw error;
  return data.map(toTeamMember);
}

/** One team member of the account, or null when that user never opened the app. */
export async function findTeamMember(
  stripeAccountId: string,
  stripeUserId: string,
): Promise<TeamMember | null> {
  const { data, error } = await getSupabase()
    .from('account_users')
    .select(ACCOUNT_USER_COLUMNS)
    .eq('stripe_account_id', stripeAccountId)
    .eq('stripe_user_id', stripeUserId)
    .maybeSingle<AccountUserRow>();
  if (error) throw error;
  return data ? toTeamMember(data) : null;
}

/**
 * POST /api/stripe-app/team — record that the signed Dashboard user is using
 * the app (with the name and email the app reported), and answer with the
 * whole team. A caller without a Dashboard user id (Connect/platform
 * contexts) is not recorded; they still get the list.
 */
export async function checkIn(
  identity: SignedIdentity,
  profile: { name?: unknown; email?: unknown },
): Promise<TeamResponse> {
  if (identity.stripeUserId) {
    await ensureStripeAccount(identity.stripeAccountId);

    const name = cleanName(profile.name);
    const email = cleanEmail(profile.email);

    // Only the columns in the payload are written, so a check-in that
    // carries no name keeps the one already on file.
    const { error } = await getSupabase()
      .from('account_users')
      .upsert(
        {
          stripe_account_id: identity.stripeAccountId,
          stripe_user_id: identity.stripeUserId,
          ...(name ? { name } : {}),
          ...(email ? { email } : {}),
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'stripe_account_id,stripe_user_id' },
      );
    if (error) throw error;
  }

  return {
    me: identity.stripeUserId,
    members: await listTeamMembers(identity.stripeAccountId),
  };
}
