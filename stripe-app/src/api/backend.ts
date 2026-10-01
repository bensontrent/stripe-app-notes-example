// src/api/backend.ts
//
// ============================================================================
//  Signed-fetch client — how this Stripe App talks to its Next.js backend
// ============================================================================
//
// Every request carries a `stripe-signature` header from
// fetchStripeSignature(). The backend proxy (stripe-app-nextjs-backend/src/proxy.ts)
// verifies that HMAC against the app's signing secret (STRIPE_APP_SIGNING_SECRET),
// which proves the request really came from this app running in the Stripe
// Dashboard — no login, cookies, or API keys needed.
//
// The signature covers { user_id, account_id }, so the backend can also
// trust the stripe-user-id / stripe-account-id headers we send. That pair is
// the whole identity of a request: notes belong to the account, and "me" is
// the user id.
//
// NOTE: the backend URL must also be listed in the `connect-src`
// content_security_policy of stripe-app.json, or fetch() will be blocked.
// ============================================================================

import type { ExtensionContextValue } from '@stripe/ui-extension-sdk/context';
import { fetchStripeSignature } from '@stripe/ui-extension-sdk/utils';
import type {
  CreateNoteBody,
  CreateNoteResponse,
  Note,
  NoteListQuery,
  NoteListResponse,
  NoteWriteResponse,
  TaskSummary,
  TeamCheckInBody,
  TeamResponse,
  UpdateNoteBody,
} from '../types/notes';
import type { PaywallDeniedBody, PaywallStatus } from '../types/paywall';
import type { SettingsPatchBody, SettingsResponse } from '../types/settings';

/**
 * The backend's base URL: `constants.API_BASE` in the manifest
 * (stripe-app.json, overridden by stripe-app.dev.json in development).
 * Published apps must use https.
 */
export function backendBase(context: ExtensionContextValue): string {
  const constants = context.environment.constants;
  const base =
    constants && typeof constants === 'object' && !Array.isArray(constants)
      ? constants.API_BASE
      : undefined;
  if (typeof base !== 'string' || !base) {
    throw new BackendConnectionError(
      'The app has no backend URL configured.',
      'Set constants.API_BASE in stripe-app.json (or stripe-app.dev.json ' +
      'for `npm run dev`) and restart `stripe apps start`.',
    );
  }
  return base.replace(/\/+$/, '');
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/**
 * Error with a setup hint attached. A signed request can fail in three
 * distinct phases — getting the signature from Stripe, reaching the
 * backend, and the backend rejecting the request — and each one has a
 * different fix. The `hint` says which fix applies so the UI doesn't have
 * to guess.
 */
export class BackendConnectionError extends Error {
  constructor(
    message: string,
    readonly hint: string,
    /** HTTP status when the backend answered with an error, else undefined. */
    readonly status?: number,
    /** The raw response body of that error answer, for callers that read it. */
    readonly body?: string,
  ) {
    super(message);
    this.name = 'BackendConnectionError';
  }
}

function signatureHint(detail: string): string {
  if (detail.includes('No such app')) {
    return (
      'Stripe can only sign requests for apps that have been uploaded. ' +
      'Run `stripe apps upload` once from stripe-app/, copy the signing ' +
      'secret into stripe-app-nextjs-backend/.env.local as STRIPE_APP_SIGNING_SECRET, then ' +
      'restart `stripe apps start`. Uploading does NOT publish the app.'
    );
  }
  return (
    'fetchStripeSignature() failed inside the dashboard preview. ' +
    'Make sure you are running the app via `stripe apps start` and are ' +
    'logged in with `stripe login`.'
  );
}

function statusHint(status: number): string {
  switch (status) {
    case 401:
    case 403:
      return (
        'The backend rejected the signature. Usually STRIPE_APP_SIGNING_SECRET in ' +
        'stripe-app-nextjs-backend/.env.local is missing or does not match this app — ' +
        'copy the signing secret from your app’s settings page in the ' +
        'Stripe Developers Dashboard (it exists after `stripe apps upload`).'
      );
    case 500:
      return (
        'The backend errored. Check the `npm run dev` terminal for the ' +
        'stack trace — a missing env var or a database that has not had ' +
        '`npm run db:setup` is the usual cause.'
      );
    default:
      return 'Check the backend terminal logs for details.';
  }
}

/** The human-readable part of an error answer: its `message`, when it has one. */
function errorMessage(status: number, statusText: string, body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === 'string' && parsed.message) return parsed.message;
  } catch {
    // Not JSON — fall through to the generic message.
  }
  return `The backend responded ${status} ${statusText}`.trim();
}

/**
 * fetch() with the headers the backend proxy expects:
 *   stripe-signature   — HMAC proving the request came from this app
 *   stripe-user-id     — the dashboard user (covered by the signature)
 *   stripe-account-id  — the Stripe account (covered by the signature)
 *   stripe-mode        — 'live' | 'test', so the backend reads the right notes
 *
 * Throws BackendConnectionError with a phase-specific setup hint.
 */
async function signedFetch<T>(
  method: Method,
  path: string,
  context: ExtensionContextValue,
  body?: unknown,
): Promise<T> {
  // Phase 1: ask Stripe for the signature. Fails before the backend is
  // ever contacted — most commonly with "No such app: <id>" when the app
  // hasn't been uploaded yet.
  let signature: string;
  try {
    signature = await fetchStripeSignature();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new BackendConnectionError(
      `Couldn't get a Stripe signature: ${detail}`,
      signatureHint(detail),
    );
  }
  const BACKEND_BASE = backendBase(context);

  // Phase 2: reach the backend at all.
  let response: Response;
  try {
    response = await fetch(`${BACKEND_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': signature,
        'stripe-user-id': context.userContext?.id ?? '',
        'stripe-account-id': context.userContext?.account.id ?? '',
        'stripe-mode': context.environment.mode,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new BackendConnectionError(
      `Couldn't reach the backend at ${BACKEND_BASE}: ${detail}`,
      'Is the backend running? Start it with `npm run dev` in ' +
      'stripe-app-nextjs-backend. For a deployed backend, its URL must also be ' +
      'listed in connect-src in stripe-app.json.',
    );
  }

  // Phase 3: the backend answered but said no.
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new BackendConnectionError(
      errorMessage(response.status, response.statusText, detail),
      statusHint(response.status),
      response.status,
      detail,
    );
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
//  Team — who a task can be assigned to (backend: src/lib/account-users.ts)
// ---------------------------------------------------------------------------

/**
 * "I'm here": records the current Dashboard user as someone who uses the app
 * in this Stripe account, with the name and email the Dashboard gave us, and
 * answers with everyone who has done the same. Stripe gives apps no team
 * list, so this is how the assignee list comes to exist.
 */
export function checkInToTeam(
  context: ExtensionContextValue,
  profile: TeamCheckInBody,
): Promise<TeamResponse> {
  return signedFetch<TeamResponse>('POST', '/api/stripe-app/team', context, profile);
}

// ---------------------------------------------------------------------------
//  Notes and tasks (backend: src/lib/notes.ts + /api/stripe-app/notes)
// ---------------------------------------------------------------------------

/** The query string for GET /api/stripe-app/notes. */
export function noteListQueryString(query: NoteListQuery): string {
  const params = new URLSearchParams();
  if (query.objectType && query.objectId) {
    params.set('objectType', query.objectType);
    params.set('objectId', query.objectId);
  }
  if (query.tasksOnly) params.set('tasks', 'true');
  if (query.assignee) params.set('assignee', query.assignee);
  if (query.status) params.set('status', query.status);
  if (query.sort) params.set('sort', query.sort);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

/** The account's notes in the current mode, filtered by `query`. */
export function listNotes(
  context: ExtensionContextValue,
  query: NoteListQuery,
): Promise<NoteListResponse> {
  return signedFetch<NoteListResponse>(
    'GET',
    `/api/stripe-app/notes${noteListQueryString(query)}`,
    context,
  );
}

/** One note, or null when it doesn't exist (any more) in this account and mode. */
export async function getNote(
  context: ExtensionContextValue,
  id: string,
): Promise<Note | null> {
  try {
    const response = await signedFetch<{ note: Note }>(
      'GET',
      `/api/stripe-app/notes/${encodeURIComponent(id)}`,
      context,
    );
    return response.note;
  } catch (error) {
    if (error instanceof BackendConnectionError && error.status === 404) return null;
    throw error;
  }
}

/** The numbers above the task queue. */
export function getTaskSummary(context: ExtensionContextValue): Promise<TaskSummary> {
  return signedFetch<TaskSummary>('GET', '/api/stripe-app/notes/summary', context);
}

export type CreateNoteResult =
  | ({ created: true } & CreateNoteResponse)
  | { created: false; status: PaywallStatus };

/**
 * Create a note. Creating notes is the paid feature, and the backend is the
 * gate: it answers 201 with the note, or 402 Payment Required with the
 * status that explains why not. A 402 is an expected answer, not an error,
 * so it is returned rather than thrown — the caller hands `status` to the
 * paywall, which then shows the right view.
 */
export async function createNote(
  context: ExtensionContextValue,
  body: CreateNoteBody,
): Promise<CreateNoteResult> {
  try {
    const response = await signedFetch<CreateNoteResponse>(
      'POST',
      '/api/stripe-app/notes',
      context,
      body,
    );
    return { created: true, ...response };
  } catch (error) {
    if (error instanceof BackendConnectionError && error.status === 402 && error.body) {
      const denied = JSON.parse(error.body) as PaywallDeniedBody;
      return { created: false, status: denied.status };
    }
    throw error;
  }
}

/** Change a note: send only the keys that change. */
export function updateNote(
  context: ExtensionContextValue,
  id: string,
  changes: UpdateNoteBody,
): Promise<NoteWriteResponse> {
  return signedFetch<NoteWriteResponse>(
    'PATCH',
    `/api/stripe-app/notes/${encodeURIComponent(id)}`,
    context,
    changes,
  );
}

export function deleteNote(
  context: ExtensionContextValue,
  id: string,
): Promise<{ deleted: true }> {
  return signedFetch<{ deleted: true }>(
    'DELETE',
    `/api/stripe-app/notes/${encodeURIComponent(id)}`,
    context,
  );
}

// ---------------------------------------------------------------------------
//  User login (see src/components/Login.tsx and the backend's
//  src/lib/stripe-app-session.ts for the full handshake). Only the person
//  paying for the app needs to log in; notes work without it.
// ---------------------------------------------------------------------------

export type UserInfoResponse = {
  userId: string;
  email: string;
  name: string | null;
  accountId: string;
};

/**
 * Who is logged in inside the dashboard for this account/user, or null when
 * nobody is (the backend answers 401 in that case).
 */
export async function getUserInfo(
  context: ExtensionContextValue,
): Promise<UserInfoResponse | null> {
  try {
    return await signedFetch<UserInfoResponse>(
      'GET',
      '/api/stripe-app/userinfo',
      context,
    );
  } catch (error) {
    if (error instanceof BackendConnectionError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

/**
 * One poll of the login handshake: true once the user has finished logging
 * in in the browser tab (the backend links them and answers 200), false
 * while the handshake is still pending (404).
 */
export async function verifyLoginState(
  context: ExtensionContextValue,
  state: string,
): Promise<boolean> {
  try {
    await signedFetch(
      'GET',
      `/api/stripe-app/verify?${new URLSearchParams({ state })}`,
      context,
    );
    return true;
  } catch (error) {
    if (error instanceof BackendConnectionError && error.status === 404) {
      return false;
    }
    throw error;
  }
}

/** Log out: the backend forgets this dashboard identity's link. */
export function deleteAppSession(
  context: ExtensionContextValue,
): Promise<{ message: string }> {
  return signedFetch<{ message: string }>(
    'DELETE',
    '/api/stripe-app/session',
    context,
  );
}

/** Browser URL the app opens for the user to log in (state = handshake key). */
export function loginPageUrl(context: ExtensionContextValue, state: string): string {
  return `${backendBase(context)}/stripe?${new URLSearchParams({ state })}`;
}

/** Browser URL that ends the user's browser session. */
export function logoutPageUrl(context: ExtensionContextValue): string {
  return `${backendBase(context)}/stripe-logout`;
}

// ---------------------------------------------------------------------------
//  App settings (see src/hooks/useSettings.tsx and src/types/settings.ts;
//  the backend half is src/lib/settings.ts + /api/stripe-app/settings)
// ---------------------------------------------------------------------------

/**
 * Both settings layers for the current Dashboard user, resolved for the
 * current mode and merged over the defaults. No login needed: the rows are
 * keyed by the signed account and user ids.
 */
export function getSettings(
  context: ExtensionContextValue,
): Promise<SettingsResponse> {
  return signedFetch<SettingsResponse>('GET', '/api/stripe-app/settings', context);
}

/**
 * Merge a few keys into one scope's settings. The backend rejects keys that
 * don't belong to that scope. Answers with the same payload as getSettings
 * so the caller can replace its state in one step.
 */
export function patchSettings(
  context: ExtensionContextValue,
  body: SettingsPatchBody,
): Promise<SettingsResponse> {
  return signedFetch<SettingsResponse>(
    'PATCH',
    '/api/stripe-app/settings',
    context,
    body,
  );
}

// ---------------------------------------------------------------------------
//  Paywall (see src/hooks/usePaywall.tsx and src/types/paywall.ts; the
//  backend half is src/lib/paywall.ts + /api/stripe-app/paywall/*). The gate
//  itself is createNote() above.
// ---------------------------------------------------------------------------

/**
 * May this Stripe account add notes, and what should the app show if not?
 * No login needed: the trial belongs to the signed account id.
 */
export function getPaywallStatus(
  context: ExtensionContextValue,
): Promise<PaywallStatus> {
  return signedFetch<PaywallStatus>('GET', '/api/stripe-app/paywall', context);
}

/** Start the account's free trial (idempotent). Answers with the new status. */
export function startTrial(
  context: ExtensionContextValue,
): Promise<PaywallStatus> {
  return signedFetch<PaywallStatus>('POST', '/api/stripe-app/paywall/trial', context);
}

/**
 * "Recheck my plan": the backend re-reads the account's subscriptions from
 * Stripe, so a plan bought a moment ago counts straight away.
 */
export function refreshPaywallStatus(
  context: ExtensionContextValue,
): Promise<PaywallStatus> {
  return signedFetch<PaywallStatus>('POST', '/api/stripe-app/paywall/refresh', context);
}

/**
 * Browser URL of the backend's public price list. No login: safe to show
 * to anyone, at any point — before the trial, during it, after it.
 */
export function plansPageUrl(context: ExtensionContextValue): string {
  return `${backendBase(context)}/plans`;
}

/**
 * Browser URL of the backend's billing page, where a logged-in user
 * subscribes and manages their plan.
 */
export function billingPageUrl(context: ExtensionContextValue): string {
  return `${backendBase(context)}/billing`;
}

/** Browser URL of the user guide. */
export function docsPageUrl(context: ExtensionContextValue): string {
  return `${backendBase(context)}/docs`;
}
