// lib/app-installs.ts
//
// ============================================================================
//  Installs and uninstalls — what happens when a Stripe account adds or
//  removes your app
// ============================================================================
//
// Stripe tells you about both through the app webhook
// (src/pages/api/webhooks/app.ts):
//
//   account.application.authorized    a Stripe account installed the app
//   account.application.deauthorized  a Stripe account uninstalled it
//
// Both carry the installing account's id in `event.account`. What this file
// does with them:
//
//   install    remember the account (name + contact email) in stripe_accounts,
//              mark it installed for the event's mode, send the welcome email
//   uninstall  mark it not installed, log its users out of the app, send the
//              "sorry to see you go" email
//
// Three things worth knowing before you change it:
//
//   1. Stripe delivers webhooks AT LEAST once, and not always in order. Both
//      handlers therefore change the row with a single conditional UPDATE
//      ("mark installed, but only if it wasn't") and act on whether a row
//      came back. A redelivered event changes nothing and emails nobody.
//
//   2. After an uninstall your API key can no longer read the account. The
//      contact email for the goodbye message has to be stored at install
//      time — that is what stripe_accounts.email is for.
//
//   3. The stripe_accounts row is never deleted. Settings and the free
//      trial hang off it (account_settings), so deleting it at uninstall
//      would hand out a fresh trial with every reinstall.
//
// Install state is tracked per mode, like everything Stripe splits by mode:
// live_installation_id / test_installation_id hold the id of the event that
// installed the app (evt_…, handy for looking the install up in the Stripe
// Dashboard) and are NULL while the app isn't installed in that mode. The
// emails are per ACCOUNT though: someone who installs in test mode first and
// live mode later gets one welcome, and one goodbye when the last install
// goes.
// ============================================================================

import type Stripe from 'stripe';
import { sendEmail } from './email';
import { goodbyeEmail, welcomeEmail, type EmailTemplate } from './email-templates';
import { getSupabase } from './supabase';

/** The stripe_accounts columns the two handlers read back. */
type InstalledAccount = {
  name: string | null;
  email: string | null;
  live_installation_id: string | null;
  test_installation_id: string | null;
};

const ACCOUNT_COLUMNS = 'name, email, live_installation_id, test_installation_id';

type InstallationColumn = 'live_installation_id' | 'test_installation_id';

function installationColumns(livemode: boolean): {
  column: InstallationColumn;
  otherColumn: InstallationColumn;
  mode: 'live' | 'test';
} {
  return livemode
    ? { column: 'live_installation_id', otherColumn: 'test_installation_id', mode: 'live' }
    : { column: 'test_installation_id', otherColumn: 'live_installation_id', mode: 'test' };
}

// ---------------------------------------------------------------------------
//  Who installed it
// ---------------------------------------------------------------------------

/**
 * The account's business name and contact email, or null when Stripe won't
 * say (the install is recorded either way). Only possible while the app is
 * installed — see point 2 above.
 */
async function retrieveAccountContact(
  stripe: Stripe,
  accountId: string,
): Promise<{ name: string | null; email: string | null } | null> {
  try {
    const account = await stripe.accounts.retrieve(accountId);
    return {
      name:
        account.business_profile?.name ||
        account.settings?.dashboard?.display_name ||
        account.company?.name ||
        null,
      email: account.email ?? null,
    };
  } catch (error) {
    console.error(
      `[app-installs] Could not retrieve account ${accountId}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
//  Email
// ---------------------------------------------------------------------------

/**
 * Send one of the two install emails and describe what happened. Never
 * throws and never fails the webhook: a missed welcome email is not worth
 * Stripe redelivering the event for.
 */
async function sendInstallEmail(
  to: string | null,
  template: EmailTemplate,
  label: 'welcome' | 'goodbye',
): Promise<string> {
  if (!to) return `no contact email on the account, ${label} email skipped`;

  const result = await sendEmail({ to, ...template });
  if (result.status === 'sent') return `${label} email sent`;
  if (result.status === 'not-configured') {
    return `${label} email skipped (set ${result.missing.join(' and ')} to send it)`;
  }
  console.error(`[app-installs] ${label} email failed: ${result.error}`);
  return `${label} email failed`;
}

// ---------------------------------------------------------------------------
//  account.application.authorized — the app was installed
// ---------------------------------------------------------------------------

/**
 * Record the install and welcome the account. `stripe` must be the client
 * for the event's own mode. Returns a one-line summary, which the webhook
 * sends back to Stripe — it shows up next to the delivery in Workbench.
 */
export async function handleAppAuthorized(
  event: Stripe.AccountApplicationAuthorizedEvent,
  stripe: Stripe,
): Promise<string> {
  const accountId = event.account;
  // Install events also reach your OWN account's endpoint, without
  // `account`. The Connect endpoint's copy is the one to act on.
  if (!accountId) return 'No account on the event, nothing to do';

  const { column, otherColumn, mode } = installationColumns(event.livemode);
  const supabase = getSupabase();
  const now = new Date().toISOString();

  // 1. Make sure the row exists and holds the latest contact details. Only
  //    the columns in the payload are written, so an account Stripe told us
  //    nothing about keeps the name and email it already had.
  const contact = await retrieveAccountContact(stripe, accountId);
  const { error: upsertError } = await supabase.from('stripe_accounts').upsert(
    {
      id: accountId,
      ...(contact?.name ? { name: contact.name } : {}),
      ...(contact?.email ? { email: contact.email } : {}),
      updated_at: now,
    },
    { onConflict: 'id' },
  );
  if (upsertError) throw upsertError;

  // 2. Mark it installed in this mode — only if it wasn't. No row back
  //    means this event (or an earlier install) already did it.
  const { data: installed, error: installError } = await supabase
    .from('stripe_accounts')
    .update({ [column]: event.id, updated_at: now })
    .eq('id', accountId)
    .is(column, null)
    .select(ACCOUNT_COLUMNS)
    .maybeSingle<InstalledAccount>();
  if (installError) throw installError;

  if (!installed) return `${accountId} was already installed in ${mode} mode, nothing to do`;

  // 3. Welcome the account — once, not once per mode.
  if (installed[otherColumn]) {
    return `${accountId} installed in ${mode} mode (already welcomed when it installed in the other mode)`;
  }
  const email = await sendInstallEmail(
    installed.email,
    welcomeEmail({ businessName: installed.name }),
    'welcome',
  );
  return `${accountId} installed in ${mode} mode, ${email}`;
}

// ---------------------------------------------------------------------------
//  account.application.deauthorized — the app was uninstalled
// ---------------------------------------------------------------------------

/**
 * Record the uninstall, clean up, and say goodbye. Needs no Stripe client:
 * from this moment the account is out of reach of your API key.
 */
export async function handleAppDeauthorized(
  event: Stripe.AccountApplicationDeauthorizedEvent,
): Promise<string> {
  const accountId = event.account;
  if (!accountId) return 'No account on the event, nothing to do';

  const { column, otherColumn, mode } = installationColumns(event.livemode);
  const supabase = getSupabase();

  // 1. Mark it not installed in this mode — only if it was. The row comes
  //    back with the contact details saved at install time.
  const { data: uninstalled, error: uninstallError } = await supabase
    .from('stripe_accounts')
    .update({ [column]: null, updated_at: new Date().toISOString() })
    .eq('id', accountId)
    .not(column, 'is', null)
    .select(ACCOUNT_COLUMNS)
    .maybeSingle<InstalledAccount>();
  if (uninstallError) throw uninstallError;

  if (!uninstalled) return `${accountId} was not installed in ${mode} mode, nothing to do`;

  if (uninstalled[otherColumn]) {
    return `${accountId} uninstalled from ${mode} mode (still installed in the other mode)`;
  }

  // 2. The app is gone from the account entirely: clean up what only makes
  //    sense while it is installed. Here that is the Dashboard logins —
  //    whoever reinstalls the app logs in again. Add your own cleanup next
  //    to it (cached Stripe data, scheduled jobs, …), but keep what a
  //    returning customer would miss: settings, the trial, memberships.
  //    A failure is logged, not thrown: step 1 already happened, so a
  //    redelivered event would stop there and never reach this line again.
  const { error: sessionsError } = await supabase
    .from('stripe_app_sessions')
    .delete()
    .eq('stripe_account_id', accountId);
  if (sessionsError) {
    console.error(`[app-installs] Could not clear the app logins of ${accountId}:`, sessionsError);
  }

  // 3. Say goodbye. A paid plan is NOT cancelled here: it belongs to a user
  //    of the website and may cover other Stripe accounts (src/lib/paywall.ts).
  //    The email tells them where to cancel it.
  const email = await sendInstallEmail(
    uninstalled.email,
    goodbyeEmail({ businessName: uninstalled.name }),
    'goodbye',
  );
  return `${accountId} uninstalled from ${mode} mode, ${email}`;
}
