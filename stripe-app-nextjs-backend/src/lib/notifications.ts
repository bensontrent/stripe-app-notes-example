// lib/notifications.ts
//
// ============================================================================
//  "You were assigned a task" — deciding whether to email, and sending it
// ============================================================================
//
// Called by the notes routes after a note has been saved. The email is a
// courtesy on top of the save, so nothing here may fail the request: every
// outcome, including an error, comes back as an AssignmentNotification the
// route passes on to the app.
//
// An email goes out when all of these hold:
//
//   • the note is a task with an assignee, and the assignee just changed
//   • the assignee is not the person who made the change (nobody needs an
//     email about what they just did themselves)
//   • the assignee has an email address on file (account_users — reported by
//     the app when they opened it)
//   • the assignee hasn't switched the emails off (the emailOnAssignment
//     user setting, for the mode the task is in)
//   • an email provider is configured (src/lib/email.ts)
// ============================================================================

import { findTeamMember } from './account-users';
import { sendEmail } from './email';
import { taskAssignedEmail } from './email-templates';
import type { SignedIdentity } from './signed-request';
import { getSupabase } from './supabase';
import { memberLabel, type AssignmentNotification, type Note } from '@/types/notes';
import { DEFAULT_SETTINGS, resolveScope, type StoredSettings } from '@/types/settings';

const DASHBOARD_PATHS: Record<Note['objectType'], string> = {
  customer: 'customers',
  invoice: 'invoices',
  payment: 'payments',
};

/**
 * The object's own page in the Stripe Dashboard, where the app's drawer
 * shows the task. The account id in the path opens it in the right account
 * for people who work in several.
 */
export function dashboardObjectUrl(identity: SignedIdentity, note: Note): string {
  const mode = identity.mode === 'live' ? '' : 'test/';
  return `https://dashboard.stripe.com/${identity.stripeAccountId}/${mode}${DASHBOARD_PATHS[note.objectType]}/${note.objectId}`;
}

/** Has this Dashboard user kept assignment emails on, in this mode? */
async function wantsAssignmentEmail(identity: SignedIdentity, stripeUserId: string): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from('user_settings')
    .select('settings')
    .eq('stripe_account_id', identity.stripeAccountId)
    .eq('stripe_user_id', stripeUserId)
    .eq('livemode', identity.mode === 'live')
    .maybeSingle<{ settings: StoredSettings }>();
  if (error) throw error;
  return resolveScope(data?.settings, 'user').emailOnAssignment ?? DEFAULT_SETTINGS.emailOnAssignment;
}

async function accountName(stripeAccountId: string): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from('stripe_accounts')
    .select('name')
    .eq('id', stripeAccountId)
    .maybeSingle<{ name: string | null }>();
  if (error) throw error;
  return data?.name ?? null;
}

/**
 * Tell the assignee about a task that was just assigned to them, if there is
 * anyone to tell. `previousAssigneeId` is who had the task before this save
 * (null for a new note). Never throws.
 */
export async function notifyAssignee(
  identity: SignedIdentity,
  note: Note,
  previousAssigneeId: string | null,
): Promise<AssignmentNotification> {
  const assigneeId = note.assigneeId;
  if (!note.isTask || !assigneeId) return 'none';
  if (assigneeId === previousAssigneeId) return 'none';
  if (assigneeId === identity.stripeUserId) return 'none';

  try {
    const [assignee, assigner, optedIn, businessName] = await Promise.all([
      findTeamMember(identity.stripeAccountId, assigneeId),
      identity.stripeUserId ? findTeamMember(identity.stripeAccountId, identity.stripeUserId) : null,
      wantsAssignmentEmail(identity, assigneeId),
      accountName(identity.stripeAccountId),
    ]);

    if (!assignee?.email) return 'no_email';
    if (!optedIn) return 'opted_out';

    const template = taskAssignedEmail({
      note,
      assignerName: memberLabel(assigner),
      assigneeName: assignee.name,
      businessName,
      dashboardUrl: dashboardObjectUrl(identity, note),
    });

    const result = await sendEmail({ to: assignee.email, ...template });
    if (result.status === 'sent') return 'sent';

    if (result.status === 'not-configured') {
      // Same fallback as the password reset link: under `next dev`, show what
      // would have been sent so the flow can be tried without a provider.
      if (process.env.NODE_ENV === 'development') {
        console.log(
          `[notifications] Email not configured (${result.missing.join(', ')}). Would have sent to ${assignee.email}:\n` +
            `Subject: ${template.subject}\n\n${template.text}\n`,
        );
      }
      return 'not_configured';
    }

    console.error(`[notifications] Assignment email failed: ${result.error}`);
    return 'failed';
  } catch (error) {
    console.error('[notifications] Could not send the assignment email:', error);
    return 'failed';
  }
}
