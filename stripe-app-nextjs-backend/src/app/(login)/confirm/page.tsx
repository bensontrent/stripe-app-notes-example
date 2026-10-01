'use client';

// Landing page for links minted by Better Auth. A password-reset email
// (see /reset-password) points at Better Auth's own endpoint, which
// validates the link and redirects here with ?token=… — or ?error=… when
// the link is invalid or expired.

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { resetPassword } from '@/lib/auth-client';
import { AuthButton, AuthError, AuthField, AuthInfo, AuthTitle } from '../components';

export default function ConfirmPage() {
  return (
    <Suspense>
      <ConfirmContent />
    </Suspense>
  );
}

function ConfirmContent() {
  const params = useSearchParams();
  const token = params?.get('token') ?? null;
  const linkError = params?.get('error') ?? null;

  if (linkError) {
    return (
      <>
        <AuthTitle>Link expired</AuthTitle>
        <AuthInfo>
          This link is invalid or has expired. Request a new one and try
          again.
        </AuthInfo>
        <div className="mt-4 text-center text-sm">
          <Link
            href="/reset-password"
            className="text-blue-600 hover:text-blue-800"
          >
            Request a new reset link
          </Link>
        </div>
      </>
    );
  }

  if (token) {
    return <NewPasswordForm token={token} />;
  }

  return (
    <>
      <AuthTitle>You&apos;re all set</AuthTitle>
      <AuthInfo>There is nothing left to confirm.</AuthInfo>
      <div className="mt-4 text-center text-sm">
        <Link href="/login" className="text-blue-600 hover:text-blue-800">
          Go to sign in
        </Link>
      </div>
    </>
  );
}

function NewPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error } = await resetPassword({ newPassword: password, token });
    setLoading(false);
    if (error) {
      setError(error.message ?? 'Could not reset the password');
      return;
    }
    setDone(true);
  };

  if (done) {
    return (
      <>
        <AuthTitle>Password updated</AuthTitle>
        <AuthInfo>
          Your password has been reset. You can now sign in with your new
          password.
        </AuthInfo>
        <div className="mt-4 text-center text-sm">
          <Link href="/login" className="text-blue-600 hover:text-blue-800">
            Go to sign in
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <AuthTitle>Choose a new password</AuthTitle>
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField
          id="password"
          label="New password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
        />

        <AuthError>{error}</AuthError>

        <AuthButton type="submit" disabled={loading}>
          {loading ? 'Saving...' : 'Reset password'}
        </AuthButton>
      </form>
    </>
  );
}
