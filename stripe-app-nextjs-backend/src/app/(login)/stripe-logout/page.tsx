'use client';

// /stripe-logout — opened in a new tab by the Stripe App's Log Out button.
// The app deletes its own link server-side (DELETE /api/stripe-app/session);
// this page just ends the *browser* session so the next login prompts for
// credentials again.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { signOut } from '@/lib/auth-client';
import { AuthButton, AuthTitle, useCanCloseWindow } from '../components';

export default function StripeLogoutPage() {
  const [done, setDone] = useState(false);
  const canCloseWindow = useCanCloseWindow();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // signOut errors when there is no session to end — that's fine here.
    signOut()
      .catch(() => undefined)
      .finally(() => setDone(true));
  }, []);

  if (!done) {
    return <AuthTitle>Signing you out…</AuthTitle>;
  }

  return (
    <>
      <AuthTitle>You&apos;ve been signed out</AuthTitle>

      <div className="space-y-4">
        <p className="text-center text-gray-600">
          You can close this window and return to Stripe to log in again.
        </p>

        {canCloseWindow && (
          <AuthButton onClick={() => window.close()}>Close window</AuthButton>
        )}

        <a
          href="https://dashboard.stripe.com"
          target="_blank"
          rel="noreferrer"
          className="block"
        >
          <AuthButton variant="secondary">Go to my Stripe dashboard</AuthButton>
        </a>

        <Link href="/login" className="block">
          <AuthButton variant="secondary">Sign in again</AuthButton>
        </Link>
      </div>
    </>
  );
}
