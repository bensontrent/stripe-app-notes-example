'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { requestPasswordReset } from '@/lib/auth-client';
import { AuthButton, AuthError, AuthField, AuthInfo, AuthTitle } from '../components';
import { appendRedirect, useSafeRedirect } from '../redirect';

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const redirect = useSafeRedirect();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Better Auth emails a link to /confirm?token=… (see sendResetPassword
    // in src/lib/auth.ts — without Postmark configured the link is printed
    // to the backend terminal instead).
    const { error } = await requestPasswordReset({
      email,
      redirectTo: '/confirm',
    });
    setLoading(false);
    if (error) {
      setError(error.message ?? 'Could not send reset instructions');
      return;
    }
    setSent(true);
  };

  return (
    <>
      <AuthTitle>Reset Password</AuthTitle>

      {sent ? (
        <div className="space-y-4">
          <AuthInfo>
            If an account exists for <strong>{email}</strong>, a password
            reset link has been sent. (Until email is configured, the link
            is printed to the backend&apos;s terminal instead.)
          </AuthInfo>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <AuthField
            id="email"
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <AuthError>{error}</AuthError>

          <AuthButton type="submit" disabled={loading}>
            {loading ? 'Sending...' : 'Send reset instructions'}
          </AuthButton>
        </form>
      )}

      <div className="mt-4 text-center text-sm">
        <Link
          href={appendRedirect('/login', redirect)}
          className="text-blue-600 hover:text-blue-800"
        >
          Back to sign in
        </Link>
      </div>
    </>
  );
}
