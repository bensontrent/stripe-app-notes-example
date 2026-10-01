// lib/email-templates.ts
//
// The emails the backend sends:
//
//   welcomeEmail()       when a Stripe account installs the app
//   goodbyeEmail()       when it uninstalls the app
//                        (both from the app webhook, src/lib/app-installs.ts)
//   taskAssignedEmail()  when someone assigns a task to a teammate
//                        (src/lib/notifications.ts)
//
// The wording is yours to change. Each returns the subject
// plus a plain-text and an HTML body, ready for sendEmail() in
// src/lib/email.ts. Everything is plain strings — no template engine, and
// nothing to configure at your email provider.
//
// Every value that comes from outside (the business name is typed by the
// merchant, a note by a teammate) goes through escapeHtml() before it is put
// into the HTML body.

import { escapeHtml, type EmailMessage } from './email';
import { paywallConfig } from './paywall';
import { OBJECT_TYPE_LABELS, PRIORITY_LABELS, type Note } from '@/types/notes';

/** What the emails call your app. Keep it in step with stripe-app.json. */
export const APP_NAME = 'Notetaskerator';

export type EmailTemplate = Pick<EmailMessage, 'subject' | 'text' | 'html'>;

export type InstallEmailData = {
  /** The Stripe account's business name, when Stripe knows one. */
  businessName?: string | null;
};

/** This backend's public URL (`npm run deploy` points it at production). */
function siteUrl(path: string): string {
  const base = (process.env.BETTER_AUTH_URL?.trim() || 'http://localhost:3006').replace(/\/+$/, '');
  return `${base}${path}`;
}

function greeting(businessName?: string | null): string {
  const name = businessName?.trim();
  return name ? `Hi ${name} team,` : 'Hi there,';
}

/**
 * "90 days or 100 notes, whichever comes first" — the paywall's own limits
 * (TRIAL_DAYS_LIMIT / TRIAL_COUNT_LIMIT), so the email can't promise a
 * different trial than the app gives. Null when there is nothing to say.
 */
function trialAllowance(): string | null {
  try {
    const { trialDaysLimit, trialCountLimit } = paywallConfig().limits;
    const days = trialDaysLimit ? `${trialDaysLimit} days` : null;
    const uses = trialCountLimit ? `${trialCountLimit} notes` : null;
    if (days && uses) return `${days} or ${uses}, whichever comes first`;
    return days ?? uses;
  } catch {
    // A mistyped limit already fails the paywall routes loudly; it shouldn't
    // also stop a welcome email.
    return null;
  }
}

// ---------------------------------------------------------------------------
//  HTML layout — one narrow column with inline styles, which is what email
//  clients render reliably.
// ---------------------------------------------------------------------------

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function paragraph(html: string): string {
  return `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:#30313d;">${html}</p>`;
}

function link(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="color:#635bff;">${escapeHtml(label)}</a>`;
}

function button(href: string, label: string): string {
  return (
    `<p style="margin:24px 0;">` +
    `<a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;border-radius:6px;` +
    `background:#635bff;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;">` +
    `${escapeHtml(label)}</a></p>`
  );
}

function list(items: string[]): string {
  return (
    `<ul style="margin:0 0 16px;padding-left:20px;font-size:16px;line-height:24px;color:#30313d;">` +
    items.map((item) => `<li style="margin-bottom:8px;">${item}</li>`).join('') +
    `</ul>`
  );
}

const INSTALL_FOOTER = `You are receiving this because ${APP_NAME} was installed in, or removed from, your Stripe account.`;

function layout(heading: string, body: string, footer: string = INSTALL_FOOTER): string {
  return (
    `<div style="margin:0;padding:32px 16px;background:#f6f8fa;font-family:${FONT};">` +
    `<div style="max-width:560px;margin:0 auto;padding:32px;background:#ffffff;border:1px solid #e3e8ee;border-radius:8px;">` +
    `<h1 style="margin:0 0 24px;font-size:22px;line-height:28px;color:#1a1f36;">${escapeHtml(heading)}</h1>` +
    body +
    `</div>` +
    `<p style="max-width:560px;margin:16px auto 0;font-size:12px;line-height:18px;color:#6a7383;text-align:center;">` +
    escapeHtml(footer) +
    `</p>` +
    `</div>`
  );
}

// ---------------------------------------------------------------------------
//  Welcome — sent on account.application.authorized
// ---------------------------------------------------------------------------

export function welcomeEmail({ businessName }: InstallEmailData = {}): EmailTemplate {
  const hello = greeting(businessName);
  const docsUrl = siteUrl('/docs');
  const plansUrl = siteUrl('/plans');
  const allowance = trialAllowance();

  const openIt = `In the Stripe Dashboard, choose ${APP_NAME} from your installed apps.`;
  const whereItLives =
    'Notes live on every customer, invoice and payment page; the full-page view is the task queue for your team.';
  const tryIt = allowance
    ? `Your free trial covers ${allowance}. The clock starts when you start the trial in the app, not today. Test mode is always free.`
    : 'Test mode is always free, so you can try everything before you go live.';

  const text = [
    hello,
    `Thanks for installing ${APP_NAME}. It is ready in your Stripe Dashboard now.`,
    'Three things to get you going:',
    [
      `1. Open it. ${openIt} ${whereItLives}`,
      `2. Try it free. ${tryIt}`,
      `3. Read the guide: ${docsUrl}`,
    ].join('\n'),
    `Plans and prices: ${plansUrl}`,
    'Stuck, or missing something? Reply to this email and tell us.',
    `— The ${APP_NAME} team`,
  ].join('\n\n');

  const html = layout(
    `Welcome to ${APP_NAME}`,
    paragraph(escapeHtml(hello)) +
      paragraph(`Thanks for installing ${escapeHtml(APP_NAME)}. It is ready in your Stripe Dashboard now.`) +
      paragraph('Three things to get you going:') +
      list([
        `<strong>Open it.</strong> ${escapeHtml(openIt)} ${escapeHtml(whereItLives)}`,
        `<strong>Try it free.</strong> ${escapeHtml(tryIt)}`,
        `<strong>Read the guide.</strong> ${link(docsUrl, 'The documentation')} walks through every feature.`,
      ]) +
      button(docsUrl, 'Read the getting-started guide') +
      paragraph(`Curious what it costs after the trial? ${link(plansUrl, 'See plans and prices')}.`) +
      paragraph('Stuck, or missing something? Reply to this email and tell us.') +
      paragraph(`— The ${escapeHtml(APP_NAME)} team`),
  );

  return { subject: `Welcome to ${APP_NAME}`, text, html };
}

// ---------------------------------------------------------------------------
//  Goodbye — sent on account.application.deauthorized
// ---------------------------------------------------------------------------

export function goodbyeEmail({ businessName }: InstallEmailData = {}): EmailTemplate {
  const hello = greeting(businessName);
  const billingUrl = siteUrl('/billing');

  // Each line is something this backend really does at uninstall (see
  // handleAppDeauthorized in src/lib/app-installs.ts). Change them together.
  const whatHappens = [
    `${APP_NAME} can no longer read or change anything in your Stripe account.`,
    'Your notes, tasks and settings are kept, so everything is as you left it if you come back.',
    `Uninstalling does not cancel a paid plan. If you have one, you can cancel it here: ${billingUrl}`,
  ];

  const text = [
    hello,
    `${APP_NAME} has been uninstalled from your Stripe account. We are sorry to see you go.`,
    'What happens now:',
    whatHappens.map((line) => `- ${line}`).join('\n'),
    'Would you tell us why you left? One line is plenty — reply to this email. It is the most useful thing we read.',
    `Changed your mind? You can install ${APP_NAME} again from the Stripe App Marketplace at any time.`,
    `— The ${APP_NAME} team`,
  ].join('\n\n');

  const html = layout(
    'Sorry to see you go',
    paragraph(escapeHtml(hello)) +
      paragraph(
        `${escapeHtml(APP_NAME)} has been uninstalled from your Stripe account. We are sorry to see you go.`,
      ) +
      paragraph('What happens now:') +
      list([
        escapeHtml(whatHappens[0]),
        escapeHtml(whatHappens[1]),
        `Uninstalling does not cancel a paid plan. If you have one, you can ${link(billingUrl, 'cancel it on the billing page')}.`,
      ]) +
      paragraph(
        '<strong>Would you tell us why you left?</strong> One line is plenty — reply to this email. It is the most useful thing we read.',
      ) +
      paragraph(
        `Changed your mind? You can install ${escapeHtml(APP_NAME)} again from the Stripe App Marketplace at any time.`,
      ) +
      paragraph(`— The ${escapeHtml(APP_NAME)} team`),
  );

  return { subject: `Sorry to see you go — ${APP_NAME} was uninstalled`, text, html };
}

// ---------------------------------------------------------------------------
//  Task assigned — sent when someone assigns a task to a teammate
//  (src/lib/notifications.ts decides whether it goes out at all)
// ---------------------------------------------------------------------------

export type TaskAssignedEmailData = {
  note: Note;
  /** Display name of whoever assigned the task. */
  assignerName: string;
  /** Display name of the person it was assigned to, when known. */
  assigneeName?: string | null;
  /** The Stripe account's business name, when known. */
  businessName?: string | null;
  /** The page of the customer, invoice or payment in the Stripe Dashboard. */
  dashboardUrl: string;
};

/** Enough of the note to act on; the rest is one click away. */
const EXCERPT_LENGTH = 600;

function excerpt(body: string): string {
  return body.length > EXCERPT_LENGTH ? `${body.slice(0, EXCERPT_LENGTH).trimEnd()}…` : body;
}

export function taskAssignedEmail(data: TaskAssignedEmailData): EmailTemplate {
  const { note, assignerName, dashboardUrl } = data;
  const hello = data.assigneeName?.trim() ? `Hi ${data.assigneeName.trim()},` : 'Hi there,';
  const business = data.businessName?.trim();

  const objectKind = OBJECT_TYPE_LABELS[note.objectType];
  const objectName = note.objectLabel ?? note.objectId;
  // "ABC-0001 (Jane Doe)" — the customer only when it adds something.
  const about =
    note.objectType !== 'customer' && note.customerLabel
      ? `${objectName} (${note.customerLabel})`
      : objectName;
  const priority = PRIORITY_LABELS[note.priority];
  const intro = `${assignerName} assigned you a task in ${APP_NAME}${business ? ` for ${business}` : ''}.`;
  const noteText = excerpt(note.body);
  const openLabel = `Open the ${objectKind.toLowerCase()} in Stripe`;
  const footer =
    `You are receiving this because a task was assigned to you in ${APP_NAME}. ` +
    `To stop these emails, switch off “Email me when a task is assigned to me” in the app.`;

  const text = [
    hello,
    intro,
    [`Priority: ${priority}`, `${objectKind}: ${about}`].join('\n'),
    noteText,
    `${openLabel}: ${dashboardUrl}`,
    footer,
  ].join('\n\n');

  const html = layout(
    'A task was assigned to you',
    paragraph(escapeHtml(hello)) +
      paragraph(escapeHtml(intro)) +
      paragraph(
        `<strong>Priority:</strong> ${escapeHtml(priority)}<br>` +
          `<strong>${escapeHtml(objectKind)}:</strong> ${escapeHtml(about)}`,
      ) +
      `<div style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #635bff;background:#f6f8fa;` +
      `font-size:16px;line-height:24px;color:#30313d;">${escapeHtml(noteText).replace(/\n/g, '<br>')}</div>` +
      button(dashboardUrl, openLabel),
    footer,
  );

  const urgency = note.priority === 'urgent' || note.priority === 'high' ? ` (${priority} priority)` : '';
  return { subject: `${assignerName} assigned you a task${urgency}`, text, html };
}
