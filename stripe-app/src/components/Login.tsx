// components/Login.tsx
//
// ============================================================================
//  Log in to the backend from inside the Stripe Dashboard
// ============================================================================
//
// A UI extension can't set cookies or render its own login form, so logging
// in is a handshake with the backend's website (modeled on Parcelcraft's
// production app, converted from Firebase to Better Auth):
//
//   1. Mint a random `state` key and open {backend}/stripe?state=… in a new
//      browser tab. The user signs in there with Better Auth as usual.
//   2. While that tab is open, poll /api/stripe-app/verify?state=… with
//      signed requests. Once the browser login completes, the backend links
//      this dashboard user to the app user and the poll returns 200.
//   3. From then on /api/stripe-app/userinfo resolves the (signed) identity
//      headers to the logged-in user — no cookies involved. Log Out deletes
//      the link and ends the browser session in another tab.
//
// Wrap gated content in <Login context={context}>…</Login>: children render
// only when logged in. Without children it renders the compact logged-in
// status line instead.

import type { ExtensionContextValue } from "@stripe/ui-extension-sdk/context";
import {
  Banner,
  Box,
  Button,
  Icon,
  Inline,
  Link,
  Spinner,
} from "@stripe/ui-extension-sdk/ui";
import { ReactNode, Reducer, useEffect, useReducer } from "react";
import {
  deleteAppSession,
  getUserInfo,
  loginPageUrl,
  logoutPageUrl,
  UserInfoResponse,
  verifyLoginState,
} from "../api/backend";

const POLL_INTERVAL_MS = 5000;

const randomStateKey = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;

// A simple state machine in plain React (a library like XState or Redux
// works just as well). Each state names what the UI is doing; actions are
// the events that move it forward.
type State =
  | { name: "initializing"; context: { stateKey: string } }
  | { name: "logged-out"; context: { stateKey: string } }
  | { name: "waiting-for-auth"; context: { stateKey: string } }
  | { name: "logged-in"; context: { user: UserInfoResponse } }
  | { name: "logging-out" };

type Action =
  | { type: "initialized"; payload: { user: UserInfoResponse | null } }
  | { type: "log-in" }
  | { type: "authorized" }
  | { type: "log-out" }
  | { type: "session-deleted" };

const initialState = (): State => ({
  name: "initializing",
  context: { stateKey: randomStateKey() },
});

const reducer: Reducer<State, Action> = (prevState, action) => {
  const fallthrough = () => {
    console.error("Invalid action", action.type, "for state", prevState.name);
    return prevState;
  };

  switch (prevState.name) {
    case "initializing":
      return action.type === "initialized"
        ? action.payload.user
          ? { name: "logged-in", context: { user: action.payload.user } }
          : { name: "logged-out", context: prevState.context }
        : fallthrough();
    case "logged-out":
      return action.type === "log-in"
        ? { name: "waiting-for-auth", context: prevState.context }
        : fallthrough();
    case "waiting-for-auth":
      switch (action.type) {
        case "authorized":
          return initialState();
        case "log-out":
          return { name: "logging-out" };
        default:
          return fallthrough();
      }
    case "logged-in":
      return action.type === "log-out"
        ? { name: "logging-out" }
        : fallthrough();
    case "logging-out":
      return action.type === "session-deleted"
        ? initialState()
        : fallthrough();
    default:
      return fallthrough();
  }
};

type LoginProps = {
  context: ExtensionContextValue;
  children?: ReactNode;
};

const Login = ({ context, children }: LoginProps) => {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);

  useEffect(() => {
    switch (state.name) {
      case "initializing": {
        // The user may or may not be logged in — ask the backend. Only when
        // it says "nobody" do we show the login button.
        let cancelled = false;
        getUserInfo(context)
          .catch(() => null) // backend unreachable → treat as logged out
          .then((user) => {
            if (!cancelled) {
              dispatch({ type: "initialized", payload: { user } });
            }
          });
        return () => {
          cancelled = true;
        };
      }
      case "waiting-for-auth": {
        // The user is logging in (and consenting) in the browser tab we
        // opened. Poll until the backend has linked them, then re-run
        // initialization to fetch who they are.
        const interval = setInterval(() => {
          verifyLoginState(context, state.context.stateKey)
            .then((linked) => linked && dispatch({ type: "authorized" }))
            .catch(() => undefined); // keep polling through transient errors
        }, POLL_INTERVAL_MS);
        return () => clearInterval(interval);
      }
      case "logging-out": {
        deleteAppSession(context)
          .catch(() => undefined) // deleting a missing session is fine
          .then(() => dispatch({ type: "session-deleted" }));
        return;
      }
    }
  }, [state, context]);

  switch (state.name) {
    case "initializing":
      return <Spinner />;

    case "logged-out":
      return (
        <Box css={{ stack: "y", gap: "small" }}>
          {children && (
            <Banner
              type="default"
              title="Log in to continue"
              description="Connect your account to use this app."
            />
          )}
          <Button
            type="primary"
            css={{ width: "fill" }}
            // The link opens the login page in a browser tab; the onPress
            // (same press) starts polling. Both are needed.
            href={loginPageUrl(state.context.stateKey)}
            target="_blank"
            onPress={() => dispatch({ type: "log-in" })}
          >
            Log in or create an account
          </Button>
        </Box>
      );

    case "waiting-for-auth":
      return (
        <Box css={{ stack: "y", gap: "small" }}>
          <Box>Please complete the login in the browser tab we opened.</Box>
          <Box css={{ stack: "x", gap: "small", alignY: "center" }}>
            <Spinner size="small" />
            <Inline css={{ font: "caption", color: "secondary" }}>
              Waiting for login confirmation…
            </Inline>
          </Box>
          <Button type="destructive" onPress={() => dispatch({ type: "log-out" })}>
            Cancel
          </Button>
        </Box>
      );

    case "logged-in":
      return (
        <Box css={{ stack: "y", gap: "small" }}>
          {children ?? (
            <Box css={{ font: "caption" }}>
              Logged in as {state.context.user.email}
            </Box>
          )}
          <Inline css={{ font: "caption" }}>
            <Link
              // Ends the browser session in a new tab; the onPress deletes
              // the app-side link.
              href={logoutPageUrl()}
              target="_blank"
              onPress={() => dispatch({ type: "log-out" })}
            >
              Log out
              <Box
                css={{
                  stack: "x",
                  alignY: "center",
                  gap: "small",
                  marginLeft: "xsmall",
                }}
              >
                <Icon name="iosShare" size="xsmall" />
              </Box>
            </Link>
          </Inline>
        </Box>
      );

    case "logging-out":
      return (
        <Button type="destructive" disabled>
          Logging out…
        </Button>
      );
  }
};

export default Login;
