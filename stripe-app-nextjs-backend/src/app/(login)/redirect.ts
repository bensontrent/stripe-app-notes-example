'use client';

// Helpers for threading the ?redirect= param through the login flow (the
// proxy sets it when it bounces a protected page to /login, including the
// query string — /stripe?state=… depends on that surviving the round-trip).

import { useSearchParams } from 'next/navigation';

const DEFAULT_REDIRECT = '/account';

/**
 * The redirect target from the URL, restricted to same-site paths so a
 * crafted link can't bounce a fresh login to another origin.
 */
export function useSafeRedirect(): string {
  const redirect = useSearchParams()?.get('redirect') ?? null;
  return redirect && redirect.startsWith('/') && !redirect.startsWith('//')
    ? redirect
    : DEFAULT_REDIRECT;
}

/** Carry the redirect target on links between the login pages. */
export function appendRedirect(path: string, redirect: string): string {
  return redirect === DEFAULT_REDIRECT
    ? path
    : `${path}?${new URLSearchParams({ redirect })}`;
}
