import { createAuthClient } from 'better-auth/react';

// No baseURL: the auth API is on the same origin as every page that uses this
// client, so Better Auth uses window.location.origin (BETTER_AUTH_URL on the
// server). One env var, BETTER_AUTH_URL, configures both sides.
export const authClient = createAuthClient();

export const {
  signIn,
  signUp,
  signOut,
  useSession,
  requestPasswordReset,
  resetPassword
} = authClient;
