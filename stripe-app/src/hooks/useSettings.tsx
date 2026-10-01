// hooks/useSettings.tsx
//
// ============================================================================
//  useSettings — one merged settings object for the whole view
// ============================================================================
//
// Wrap a view (or the part of it that needs settings) in <SettingsProvider>
// and call useSettings() anywhere below it:
//
//   const { settings, updateUserSettings, updateAccountSettings } = useSettings();
//   <Switch checked={settings.emailOnAssignment}
//           onChange={(e) => updateUserSettings({ emailOnAssignment: e.target.checked })} />
//
// `settings` is defaults + account-scoped + user-scoped values, for the mode
// the app is running in — the developer chose each setting's scope once, in
// src/types/settings.ts, and the two update functions are typed so a user
// setting can't be sent to the account scope by accident.
//
// Identity is the signed request itself (stripe-account-id + stripe-user-id
// from fetchStripeSignature()), so settings are available as soon as the
// app is installed — no login step.
//
// Updates are optimistic: the change shows immediately, the PATCH goes out,
// and the backend's answer (the full payload again) replaces local state.
// If the PATCH fails the provider reloads from the backend, so the UI never
// keeps a value the database doesn't have.
//
// Why a provider and not a module-level cache: every component that calls
// the hook sees the same state and the same updates, with no manual
// invalidation. The state lives exactly as long as the view does; the next
// time the view opens it is fetched again. That is the only cache the
// settings need — the backend deliberately has none (see its
// src/lib/settings.ts).

import type { ExtensionContextValue } from "@stripe/ui-extension-sdk/context";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BackendConnectionError,
  getSettings,
  patchSettings,
} from "../api/backend";
import {
  AccountSettings,
  DEFAULT_SETTINGS,
  mergeLayers,
  Settings,
  SettingsPatch,
  SettingsResponse,
  StripeMode,
  UserSettings,
} from "../types/settings";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export type SettingsError = {
  message: string;
  hint?: string;
  /** HTTP status when the backend answered with an error. */
  status?: number;
};

export type SettingsContextValue = {
  /** 'loading' until the first fetch answers; 'error' if it failed. */
  status: "loading" | "ready" | "error";
  error: SettingsError | null;
  /** Defaults + account + user, for the current mode. Defaults until loaded. */
  settings: Settings;
  /** Account-scoped values actually stored (no defaults). */
  account: Partial<AccountSettings>;
  /** User-scoped values actually stored (no defaults). */
  user: Partial<UserSettings>;
  mode: StripeMode;
  /** State of the most recent save. */
  saveStatus: SaveStatus;
  saveError: SettingsError | null;
  updateUserSettings: (patch: SettingsPatch<UserSettings>) => Promise<void>;
  updateAccountSettings: (patch: SettingsPatch<AccountSettings>) => Promise<void>;
  /** Re-fetch from the backend, discarding local state. */
  reload: () => Promise<void>;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

const toSettingsError = (error: unknown): SettingsError => ({
  message: error instanceof Error ? error.message : String(error),
  hint: error instanceof BackendConnectionError ? error.hint : undefined,
  status: error instanceof BackendConnectionError ? error.status : undefined,
});

/** Apply a patch to a resolved layer: null forgets the key, anything else sets it. */
function applyPatch<S extends object>(
  layer: Partial<S>,
  patch: SettingsPatch<S>,
): Partial<S> {
  const next: Partial<S> = { ...layer };
  for (const key of Object.keys(patch) as (keyof S)[]) {
    const value = patch[key];
    if (value === null || value === undefined) {
      delete next[key];
    } else {
      next[key] = value as S[keyof S];
    }
  }
  return next;
}

type LoadedState = Pick<SettingsResponse, "account" | "user" | "mode">;

const initialLoaded = (context: ExtensionContextValue): LoadedState => ({
  account: {},
  user: {},
  mode: context.environment.mode === "live" ? "live" : "test",
});

type SettingsProviderProps = {
  context: ExtensionContextValue;
  children: ReactNode;
};

export function SettingsProvider({ context, children }: SettingsProviderProps) {
  const [status, setStatus] = useState<SettingsContextValue["status"]>("loading");
  const [error, setError] = useState<SettingsError | null>(null);
  const [loaded, setLoaded] = useState<LoadedState>(() => initialLoaded(context));
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<SettingsError | null>(null);

  // Saves can overlap (two switches flipped quickly). Each PATCH answers with
  // the full state as of its own merge, so only the most recently STARTED
  // save may write its answer into local state — an older answer arriving
  // late would undo a newer optimistic change.
  const latestSave = useRef(0);
  const pendingSaves = useRef(0);

  const reload = useCallback(async () => {
    try {
      const response = await getSettings(context);
      setLoaded(response);
      setError(null);
      setStatus("ready");
    } catch (caught) {
      setError(toSettingsError(caught));
      setStatus("error");
    }
  }, [context]);

  useEffect(() => {
    let cancelled = false;
    getSettings(context)
      .then((response) => {
        if (cancelled) return;
        setLoaded(response);
        setStatus("ready");
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(toSettingsError(caught));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [context]);

  const save = useCallback(
    async (
      scope: "user" | "account",
      patch: SettingsPatch<UserSettings> | SettingsPatch<AccountSettings>,
    ) => {
      const saveId = ++latestSave.current;
      pendingSaves.current += 1;
      setSaveStatus("saving");
      setSaveError(null);

      // Optimistic: show the change now.
      setLoaded((previous) =>
        scope === "user"
          ? { ...previous, user: applyPatch(previous.user, patch as SettingsPatch<UserSettings>) }
          : { ...previous, account: applyPatch(previous.account, patch as SettingsPatch<AccountSettings>) },
      );

      try {
        const response =
          scope === "user"
            ? await patchSettings(context, { scope, settings: patch as SettingsPatch<UserSettings> })
            : await patchSettings(context, { scope, settings: patch as SettingsPatch<AccountSettings> });
        if (saveId === latestSave.current) {
          setLoaded(response);
        }
      } catch (caught) {
        setSaveError(toSettingsError(caught));
        setSaveStatus("error");
        // Drop the optimistic value: the database is the truth. The error
        // is reported through saveError rather than thrown, so event
        // handlers can call update* without a try/catch.
        await reload();
      } finally {
        pendingSaves.current -= 1;
        if (pendingSaves.current === 0) {
          setSaveStatus((current) => (current === "error" ? "error" : "saved"));
        }
      }
    },
    [context, reload],
  );

  const updateUserSettings = useCallback(
    (patch: SettingsPatch<UserSettings>) => save("user", patch),
    [save],
  );
  const updateAccountSettings = useCallback(
    (patch: SettingsPatch<AccountSettings>) => save("account", patch),
    [save],
  );

  const value = useMemo<SettingsContextValue>(
    () => ({
      status,
      error,
      settings:
        status === "ready"
          ? mergeLayers(loaded.account, loaded.user)
          : DEFAULT_SETTINGS,
      account: loaded.account,
      user: loaded.user,
      mode: loaded.mode,
      saveStatus,
      saveError,
      updateUserSettings,
      updateAccountSettings,
      reload,
    }),
    [status, error, loaded, saveStatus, saveError, updateUserSettings, updateAccountSettings, reload],
  );

  return (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
}

/** Read and update the app's settings. Must be rendered inside <SettingsProvider>. */
export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) {
    throw new Error("useSettings() must be used inside <SettingsProvider>");
  }
  return value;
}
