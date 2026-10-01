'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { signIn } from '@/lib/auth-client';
import { useRouter } from 'next/navigation';
import { AuthButton, AuthError, AuthField, AuthTitle } from '../components';
import { appendRedirect, useSafeRedirect } from '../redirect';

// useSearchParams() (inside useSafeRedirect) forces a client-side bailout,
// so it must sit under a Suspense boundary for `next build` to prerender
// this page.
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const redirect = useSafeRedirect();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error } = await signIn.email({ email, password });
    if (error) {
      setError(error.message ?? 'Authentication failed');
      setLoading(false);
      return;
    }
    router.push(redirect);
  };

  return (
    <>
      <AuthTitle>Sign In</AuthTitle>

      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <AuthField
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
        />

        <AuthError>{error}</AuthError>

        <AuthButton type="submit" disabled={loading}>
          {loading ? 'Loading...' : 'Sign In'}
        </AuthButton>
      </form>

      <div className="mt-4 flex flex-col items-center gap-2 text-sm">
        <Link
          href={appendRedirect('/reset-password', redirect)}
          className="text-blue-600 hover:text-blue-800"
        >
          Forgot your password?
        </Link>
        <Link
          href={appendRedirect('/register', redirect)}
          className="text-blue-600 hover:text-blue-800"
        >
          Don&apos;t have an account? Create one
        </Link>
      </div>
    </>
  );
}
