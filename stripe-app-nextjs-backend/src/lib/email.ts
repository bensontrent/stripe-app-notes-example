// Transactional email through Postmark's REST API (no SDK needed).
//
// Email is optional: without POSTMARK_SERVER_API_TOKEN and
// POSTMARK_FROM_EMAIL nothing is sent and sendEmail() reports
// 'not-configured', so callers can fall back (src/lib/auth.ts prints the
// password reset link to the terminal instead; src/lib/app-installs.ts
// skips the welcome / goodbye email and says so).
//
// POSTMARK_FROM_EMAIL must be a sender signature or domain you have verified
// in Postmark. While a Postmark account is still in test mode it only
// delivers to addresses on that same domain.

const POSTMARK_URL = 'https://api.postmarkapp.com/email';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export type EmailResult =
  | { status: 'sent'; messageId: string }
  | { status: 'not-configured'; missing: string[] }
  | { status: 'failed'; error: string };

export function isEmailConfigured(): boolean {
  return missingEmailConfig().length === 0;
}

function missingEmailConfig(): string[] {
  return ['POSTMARK_SERVER_API_TOKEN', 'POSTMARK_FROM_EMAIL'].filter(
    (name) => !process.env[name]?.trim()
  );
}

/** Never throws — a mail outage must not turn into a failed request. */
export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const missing = missingEmailConfig();
  if (missing.length > 0) return { status: 'not-configured', missing };

  try {
    const response = await fetch(POSTMARK_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': process.env.POSTMARK_SERVER_API_TOKEN!.trim(),
      },
      body: JSON.stringify({
        From: process.env.POSTMARK_FROM_EMAIL!.trim(),
        To: message.to,
        Subject: message.subject,
        TextBody: message.text,
        HtmlBody: message.html,
        MessageStream: process.env.POSTMARK_MESSAGE_STREAM?.trim() || 'outbound',
      }),
    });

    // Postmark answers errors with { ErrorCode, Message }, e.g. 422 when the
    // From address isn't a verified sender signature.
    const body = (await response.json().catch(() => null)) as {
      ErrorCode?: number;
      Message?: string;
      MessageID?: string;
    } | null;

    if (!response.ok || (body?.ErrorCode ?? 0) !== 0) {
      return {
        status: 'failed',
        error: `Postmark ${response.status}: ${body?.Message ?? response.statusText}`,
      };
    }
    return { status: 'sent', messageId: body?.MessageID ?? '' };
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
