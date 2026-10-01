// hooks/useTeam.tsx
//
// ============================================================================
//  useTeam — who is on the team, and who am I
// ============================================================================
//
// Wrap a view in <TeamProvider> and call useTeam() anywhere below it:
//
//   const { members, me, nameOf } = useTeam();
//
// Stripe gives an app no list of the account's team members. So when a view
// opens, the provider "checks in": it tells the backend who is looking (the
// name from the Dashboard's user context and the email from
// getDashboardUserEmail(), which needs the user_email_read permission), and
// the backend answers with everyone who has ever done the same. That list is
// who a task can be assigned to. A teammate who has never opened the app
// isn't on it yet.
//
// The check-in is best effort: if it fails, the view still works, the
// assignee list is just empty and names fall back to "A teammate". Like the
// other providers, the state lives as long as the view does.

import type { ExtensionContextValue } from "@stripe/ui-extension-sdk/context";
import { getDashboardUserEmail } from "@stripe/ui-extension-sdk/utils";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { checkInToTeam } from "../api/backend";
import { memberLabel, type TeamMember } from "../types/notes";

export type TeamContextValue = {
  /** 'loading' until the check-in answers; 'error' if it failed. */
  status: "loading" | "ready" | "error";
  /** Everyone who has opened the app in this account, most recent first. */
  members: TeamMember[];
  /** The current Dashboard user's id ('' when there is none). */
  me: string;
  /** Display name for a user id: "Jane Doe", "You", or a stand-in. */
  nameOf: (stripeUserId: string | null | undefined) => string;
};

const TeamContext = createContext<TeamContextValue | null>(null);

/** The user's email, or null when the Dashboard won't say (permission not granted). */
async function readEmail(): Promise<string | null> {
  try {
    const { email } = await getDashboardUserEmail();
    return email || null;
  } catch {
    return null;
  }
}

type TeamProviderProps = {
  context: ExtensionContextValue;
  children: ReactNode;
};

export function TeamProvider({ context, children }: TeamProviderProps) {
  const [status, setStatus] = useState<TeamContextValue["status"]>("loading");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const me = context.userContext?.id ?? "";

  useEffect(() => {
    let cancelled = false;
    readEmail()
      .then((email) =>
        checkInToTeam(context, { name: context.userContext?.name ?? null, email }),
      )
      .then((team) => {
        if (cancelled) return;
        setMembers(team.members);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [context]);

  const nameOf = useCallback(
    (stripeUserId: string | null | undefined) => {
      if (!stripeUserId) return "Nobody";
      if (stripeUserId === me) return "You";
      return memberLabel(members.find((member) => member.id === stripeUserId));
    },
    [members, me],
  );

  const value = useMemo<TeamContextValue>(
    () => ({ status, members, me, nameOf }),
    [status, members, me, nameOf],
  );

  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
}

/** Read the team. Must be rendered inside <TeamProvider>. */
export function useTeam(): TeamContextValue {
  const value = useContext(TeamContext);
  if (!value) {
    throw new Error("useTeam() must be used inside <TeamProvider>");
  }
  return value;
}
