'use client';

import { useSession } from '@/lib/auth-client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface StripeAccount {
  stripeAccountId: string;
  name: string | null;
  role: string;
  liveInstallationId: string | null;
  testInstallationId: string | null;
}

// Badge tints paired light/dark so they stay readable on both themes.
const BADGES = {
  role: 'bg-purple-100 text-purple-800 dark:bg-purple-400/10 dark:text-purple-300',
  live: 'bg-blue-100 text-blue-800 dark:bg-blue-400/10 dark:text-blue-300',
  test: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-400/10 dark:text-yellow-300',
  verified: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300',
  unverified: 'bg-amber-100 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300',
};

export default function AccountPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [accounts, setAccounts] = useState<StripeAccount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isPending && !session) {
      router.push('/login');
    }
  }, [session, isPending, router]);

  useEffect(() => {
    if (session) {
      fetchAccounts();
    }
  }, [session]);

  const fetchAccounts = async () => {
    try {
      const response = await fetch('/api/protected/stripe-app');
      if (response.ok) {
        const data = await response.json();
        setAccounts(data.accounts);
      }
    } catch (error) {
      console.error('Error fetching accounts:', error);
    } finally {
      setLoading(false);
    }
  };

  if (isPending || loading) {
    return (
      <main className="mx-auto flex w-full max-w-4xl items-center justify-center px-6 py-24">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading…</p>
      </main>
    );
  }

  if (!session) {
    return null;
  }

  const { user } = session;
  const initials = (user.name || user.email)
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
  const memberSince = new Date(user.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-12">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Account
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Your profile and connected Stripe accounts.
        </p>
      </div>

      <section
        aria-label="Profile information"
        className="rounded-2xl border border-black/[.08] p-6 dark:border-white/[.145]"
      >
        <div className="flex items-center gap-4">
          <div
            aria-hidden="true"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#635BFF]/10 text-lg font-semibold text-[#635BFF] dark:bg-[#635BFF]/25 dark:text-[#b3aeff]"
          >
            {initials}
          </div>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-black dark:text-zinc-50">
              {user.name || 'Unnamed user'}
            </p>
            <p className="truncate text-sm text-zinc-600 dark:text-zinc-400">{user.email}</p>
          </div>
        </div>

        <dl className="mt-6 grid gap-6 border-t border-black/[.08] pt-6 sm:grid-cols-2 dark:border-white/[.145]">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
              Email status
            </dt>
            <dd className="mt-1.5">
              <span
                className={`inline-flex rounded-full px-3 py-1 text-sm ${
                  user.emailVerified ? BADGES.verified : BADGES.unverified
                }`}
              >
                {user.emailVerified ? 'Verified' : 'Unverified'}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
              Member since
            </dt>
            <dd className="mt-1.5 text-sm text-black dark:text-zinc-50">{memberSince}</dd>
          </div>
        </dl>
      </section>

      <section aria-label="Stripe accounts">
        <h2 className="text-xl font-semibold text-black dark:text-zinc-50">Stripe accounts</h2>
        {accounts.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
            No connected Stripe accounts found.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {accounts.map((account) => {
              const installations = [
                { mode: 'Live', installationId: account.liveInstallationId },
                { mode: 'Test', installationId: account.testInstallationId },
              ].filter((i) => i.installationId !== null);

              return (
                <div
                  key={account.stripeAccountId}
                  className="rounded-2xl border border-black/[.08] p-5 transition-colors hover:bg-black/[.02] dark:border-white/[.145] dark:hover:bg-white/[.04]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <p className="font-medium text-black dark:text-zinc-50">
                      {account.name || 'Stripe Account'}: {account.stripeAccountId}
                    </p>
                    <span
                      className={`shrink-0 rounded-full px-3 py-1 text-sm capitalize ${BADGES.role}`}
                    >
                      {account.role}
                    </span>
                  </div>
                  {installations.length === 0 ? (
                    <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                      Not installed in any mode.
                    </p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {installations.map((installation) => (
                        <div
                          key={installation.mode}
                          className="flex items-start justify-between gap-4"
                        >
                          <p className="text-sm text-zinc-600 dark:text-zinc-400">
                            Installation ID: {installation.installationId}
                          </p>
                          <span
                            className={`shrink-0 rounded-full px-3 py-1 text-sm ${
                              installation.mode === 'Live' ? BADGES.live : BADGES.test
                            }`}
                          >
                            {installation.mode}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
