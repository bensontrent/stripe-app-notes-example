'use client';

// /end-session — generic "sign me out" page: ends the Better Auth browser
// session and offers the way back. Useful as a logout link target from
// anywhere (emails, docs, other apps) without wiring up a button first.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { signOut } from '@/lib/auth-client';
import { AuthButton, AuthTitle } from '../components';

export default function EndSessionPage() {
  const [done, setDone] = useState(false);
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
    return <AuthTitle>Ending your session…</AuthTitle>;
  }

  return (
    <>
      <AuthTitle>Session ended</AuthTitle>

      <div className="space-y-4">
        <p className="text-center text-gray-600">You have been signed out.</p>

        <Link href="/login" className="block">
          <AuthButton>Sign in again</AuthButton>
        </Link>

        <Link href="/" className="block">
          <AuthButton variant="secondary">Go to the home page</AuthButton>
        </Link>
      </div>
    </>
  );
}
