'use client';

// /stripe?state=… — the browser half of the Stripe App login handshake.
//
// The Stripe App opens this page in a new tab with the state key it minted.
// The proxy guards it, so by the time it renders the user has a Better Auth
// session (new visitors bounce through /login and back, state intact).
// Posting the state to /api/stripe-app/session lets the app's polling
// (/api/stripe-app/verify) link this user to the dashboard identity.

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signOut, useSession } from '@/lib/auth-client';
import {
  AuthButton,
  AuthError,
  AuthInfo,
  AuthTitle,
  useCanCloseWindow,
} from '../components';

export default function StripeLoginPage() {
  return (
    <Suspense>
      <StripeLogin />
    </Suspense>
  );
}

function StripeLogin() {
  const { data: session, isPending } = useSession();
  const state = useSearchParams()?.get('state') ?? null;
  const router = useRouter();

  const [status, setStatus] = useState<'saving' | 'done' | 'error'>('saving');
  const canCloseWindow = useCanCloseWindow();
  const posted = useRef(false);

  useEffect(() => {
    if (!session || !state || posted.current) return;
    posted.current = true;

    fetch('/api/stripe-app/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    })
      .then((res) => setStatus(res.ok ? 'done' : 'error'))
      .catch(() => setStatus('error'));
  }, [session, state]);

  const handleSwitchAccount = async () => {
    await signOut();
    // Land back here (state intact) after signing in as someone else.
    router.push(`/login?${new URLSearchParams({ redirect: `/stripe?state=${state}` })}`);
  };

  if (!state) {
    return (
      <>
        <AuthTitle>Please try logging in again</AuthTitle>
        <AuthInfo>
          This page is missing its login key. Open the app in Stripe and
          press its login button again — you&apos;ll be sent back here to
          complete the connection.
        </AuthInfo>
      </>
    );
  }

  if (isPending || (session && status === 'saving')) {
    return (
      <>
        <AuthTitle>Connecting…</AuthTitle>
        <p className="text-center text-gray-600">
          Linking your account to Stripe.
        </p>
      </>
    );
  }

  if (status === 'error') {
    return (
      <>
        <AuthTitle>Something went wrong</AuthTitle>
        <AuthError>
          Your login could not be linked. Return to Stripe and try again.
        </AuthError>
      </>
    );
  }

  return (
    <>
      <AuthTitle>You&apos;ve successfully logged in</AuthTitle>

      <div className="space-y-4">
        <p className="text-center text-gray-600">
          Signed in as <strong>{session?.user.email}</strong>. You can close
          this window and return to Stripe.
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

        <Link href="/account" className="block">
          <AuthButton variant="secondary">Go to my account</AuthButton>
        </Link>

        <AuthButton variant="secondary" onClick={handleSwitchAccount}>
          Sign in as a different user
        </AuthButton>
      </div>
    </>
  );
}
