'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { signUp } from '@/lib/auth-client';
import { useRouter } from 'next/navigation';
import { AuthButton, AuthError, AuthField, AuthTitle } from '../components';
import { appendRedirect, useSafeRedirect } from '../redirect';

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const [name, setName] = useState('');
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

    // Better Auth signs the new user in automatically on success.
    const { error } = await signUp.email({ email, password, name });
    if (error) {
      setError(error.message ?? 'Registration failed');
      setLoading(false);
      return;
    }
    router.push(redirect);
  };

  return (
    <>
      <AuthTitle>Create Account</AuthTitle>

      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField
          id="name"
          label="Name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
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
          {loading ? 'Loading...' : 'Sign Up'}
        </AuthButton>
      </form>

      <div className="mt-4 text-center text-sm">
        <Link
          href={appendRedirect('/login', redirect)}
          className="text-blue-600 hover:text-blue-800"
        >
          Already have an account? Sign in
        </Link>
      </div>
    </>
  );
}
