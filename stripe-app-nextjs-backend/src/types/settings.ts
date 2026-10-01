// types/settings.ts
//
// ============================================================================
//  App settings — the single definition of every setting the app stores
// ============================================================================
//
// IDENTICAL copies of this file live in both projects:
//
//   stripe-app-nextjs-backend/src/types/settings.ts   (validates and stores)
//   stripe-app/src/types/settings.ts                  (the useSettings hook)
//
// Keep them in sync — they are separate npm packages, and a shared package
// would be more ceremony than a 200-line file deserves. Nothing here imports
// anything, so the file compiles in both.
//
// The model, in one paragraph: a setting belongs to exactly one SCOPE.
// Account-scoped settings live in the account_settings table and are shared
// by everyone in that Stripe account; user-scoped settings live in
// user_settings and belong to one Dashboard user. The owners are the ids
// every signed request carries — the Stripe account (acct_…) and the
// Dashboard user (usr_…) — so settings need no app login. Both tables are
// keyed by (owner, livemode), so test-mode settings and live-mode settings
// are different rows — what you configure in test mode never applies in
// live mode. The same two routes serve both modes; the app's `stripe-mode`
// header picks the row. The backend merges defaults + account + user for
// that mode into one flat `Settings` object, and that is what the UI reads.
//
// To add a setting: add it to AccountSettings or UserSettings, give it a
// default, and say where it lives in SETTING_DEFINITIONS. TypeScript refuses
// to compile until all three agree.
// ============================================================================

export type SettingsScope = 'user' | 'account';
export type StripeMode = 'live' | 'test';

/**
 * Settings shared by everyone in the Stripe account (account_settings).
 * None yet — the scope, its table and its route are in place for the first
 * one (add the key here, a default below and a line in SETTING_DEFINITIONS).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type AccountSettings = {};

/** Settings that belong to the Dashboard user alone (user_settings). */
export type UserSettings = {
  /** Email me when someone else assigns a task to me. */
  emailOnAssignment: boolean;
};

/** Everything the UI reads: account and user settings merged over defaults. */
export type Settings = AccountSettings & UserSettings;
export type SettingKey = keyof Settings;

export const DEFAULT_SETTINGS: Settings = {
  emailOnAssignment: true,
};

type SettingDefinition = {
  /** Which table the value is stored in. */
  scope: SettingsScope;
  /** Allowed values, for settings that are an enum. */
  options?: readonly string[];
};

/**
 * Where each setting lives. This map is where a developer decides whether a
 * setting is account-wide or user-specific. Typed against SettingKey, so a
 * setting missing from here (or a typo) is a compile error.
 */
export const SETTING_DEFINITIONS: Record<SettingKey, SettingDefinition> = {
  emailOnAssignment: { scope: 'user' },
};

export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as SettingKey[];

/** The keys that live in a given scope, e.g. keysForScope('user'). */
export function keysForScope(scope: SettingsScope): SettingKey[] {
  return SETTING_KEYS.filter((key) => SETTING_DEFINITIONS[key].scope === scope);
}

/**
 * What a settings jsonb column holds. Values are unknown until validated —
 * a row may hold keys from an older version of this file.
 */
export type StoredSettings = { [key: string]: unknown };

/**
 * A patch for one scope: the keys to change, with `null` meaning "forget the
 * stored value so the default applies again".
 */
export type SettingsPatch<S> = { [K in keyof S]?: S[K] | null };

/** PATCH /api/stripe-app/settings request body. */
export type SettingsPatchBody =
  | { scope: 'user'; settings: SettingsPatch<UserSettings> }
  | { scope: 'account'; settings: SettingsPatch<AccountSettings> };

/** GET and PATCH /api/stripe-app/settings both answer with this. */
export type SettingsResponse = {
  /** Defaults + account + user, for `mode`. What the UI reads. */
  settings: Settings;
  /** The account-scoped values actually stored for `mode`, no defaults. */
  account: Partial<AccountSettings>;
  /** The user-scoped values actually stored for `mode`, no defaults. */
  user: Partial<UserSettings>;
  /** Which rows were read: the mode the app is running in. */
  mode: StripeMode;
};

// ---------------------------------------------------------------------------
//  Reading: stored jsonb → the flat Settings object
// ---------------------------------------------------------------------------

/** Is this value one the setting accepts? (Wrong-typed leftovers are ignored on read and rejected on write.) */
function isValidValue(key: SettingKey, value: unknown): boolean {
  const definition = SETTING_DEFINITIONS[key];
  if (definition.options) {
    return typeof value === 'string' && definition.options.includes(value);
  }
  return typeof value === typeof DEFAULT_SETTINGS[key];
}

/**
 * The values one scope's row contributes: its own keys only, skipping
 * anything missing or invalid. No defaults — see resolveSettings for the
 * full merge.
 */
export function resolveScope<S extends SettingsScope>(
  stored: StoredSettings | null | undefined,
  scope: S,
): Partial<S extends 'account' ? AccountSettings : UserSettings> {
  const resolved: Partial<Settings> = {};
  for (const key of keysForScope(scope)) {
    const value = stored?.[key];
    if (value !== undefined && value !== null && isValidValue(key, value)) {
      (resolved as Record<string, unknown>)[key] = value;
    }
  }
  return resolved as Partial<S extends 'account' ? AccountSettings : UserSettings>;
}

/**
 * Defaults, then account, then user. Each scope only ever contributes its
 * own keys, so the order only matters for documentation: the more specific
 * layer is listed last.
 */
export function resolveSettings(
  account: StoredSettings | null | undefined,
  user: StoredSettings | null | undefined,
): Settings {
  return mergeLayers(resolveScope(account, 'account'), resolveScope(user, 'user'));
}

/** Defaults + already-resolved layers. The hook uses this for optimistic updates. */
export function mergeLayers(
  account: Partial<AccountSettings>,
  user: Partial<UserSettings>,
): Settings {
  return { ...DEFAULT_SETTINGS, ...account, ...user };
}

// ---------------------------------------------------------------------------
//  Writing: checking a patch before it reaches the database
// ---------------------------------------------------------------------------

/** Keep a stray 100 KB string out of a jsonb column. */
const MAX_STRING_LENGTH = 500;

export type ValidatedPatch =
  | { ok: true; stored: StoredSettings }
  | { ok: false; error: string };

/**
 * Check a patch against the definitions. `null` passes through so the
 * database can delete the key.
 *
 * Rejects (with a message fit for a 400 response): keys that don't exist,
 * keys that belong to the other scope, and values of the wrong type.
 */
export function validatePatch(scope: SettingsScope, patch: unknown): ValidatedPatch {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    return { ok: false, error: 'settings must be an object' };
  }

  const stored: StoredSettings = {};
  const entries = Object.entries(patch as Record<string, unknown>);
  if (entries.length === 0) {
    return { ok: false, error: 'settings is empty' };
  }

  for (const [key, value] of entries) {
    // hasOwnProperty keeps "__proto__" and friends out of the lookup.
    if (!Object.prototype.hasOwnProperty.call(SETTING_DEFINITIONS, key)) {
      return { ok: false, error: `Unknown setting "${key}"` };
    }
    const settingKey = key as SettingKey;
    const definition = SETTING_DEFINITIONS[settingKey];

    if (definition.scope !== scope) {
      return {
        ok: false,
        error: `"${key}" is ${definition.scope === 'account' ? 'an account' : 'a user'} setting — send it with scope "${definition.scope}"`,
      };
    }
    if (value !== null) {
      if (!isValidValue(settingKey, value)) {
        const expected = definition.options
          ? `one of ${definition.options.join(', ')}`
          : `a ${typeof DEFAULT_SETTINGS[settingKey]}`;
        return { ok: false, error: `"${key}" must be ${expected}` };
      }
      if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
        return { ok: false, error: `"${key}" must be ${MAX_STRING_LENGTH} characters or fewer` };
      }
    }

    stored[key] = value;
  }

  return { ok: true, stored };
}

/** A patch that forgets every stored value in a scope, so defaults apply again. */
export function resetPatch<S extends SettingsScope>(
  scope: S,
): S extends 'account' ? SettingsPatch<AccountSettings> : SettingsPatch<UserSettings> {
  const patch: Record<string, null> = {};
  for (const key of keysForScope(scope)) patch[key] = null;
  return patch as S extends 'account'
    ? SettingsPatch<AccountSettings>
    : SettingsPatch<UserSettings>;
}
