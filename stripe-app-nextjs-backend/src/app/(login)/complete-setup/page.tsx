'use client';

// /complete-setup — shown to a signed-in user whose account isn't linked to
// any Stripe account yet (e.g. they registered on the website first). Walks
// them through linking via the app inside the Stripe Dashboard.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut, useSession } from '@/lib/auth-client';
import { AuthButton, AuthTitle } from '../components';

const STEPS = [
  <>Install this app in your{' '}
    <a
      href="https://dashboard.stripe.com"
      target="_blank"
      rel="noreferrer"
      className="text-blue-600 hover:text-blue-800"
    >
      Stripe Dashboard
    </a>
    .
  </>,
  <>Open the app and press its <strong>Log in</strong> button to link this
    account.
  </>,
  <>
    <Link href="/account" className="text-blue-600 hover:text-blue-800">
      Reload your account page
    </Link>{' '}
    after linking.
  </>,
];

export default function CompleteSetupPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const handleSwitchAccount = async () => {
    await signOut();
    router.push('/login');
  };

  return (
    <>
      <AuthTitle>Complete your setup</AuthTitle>

      <div className="space-y-4">
        {session && (
          <p className="text-center text-gray-600">
            You are signed in as <strong>{session.user.email}</strong>, but
            this account isn&apos;t linked to a Stripe account yet.
          </p>
        )}

        <ol className="space-y-3">
          {STEPS.map((step, index) => (
            <li key={index} className="flex gap-3 text-sm text-gray-800">
              <span className="flex-none flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-800 font-medium">
                {index + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>

        <AuthButton variant="secondary" onClick={handleSwitchAccount}>
          Sign in to a different account
        </AuthButton>
      </div>
    </>
  );
}
