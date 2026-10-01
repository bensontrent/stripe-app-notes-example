'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { signOut, useSession } from '@/lib/auth-client';
import Logo from './Logo';

// Site-wide nav bar rendered by the (site) layout. A client component for the
// mobile menu toggle, the active-link highlight, and the session-aware
// login/sign-out button (Better Auth's useSession).

const NAV_LINKS = [
  { href: '/', label: 'Home', exact: true },
  { href: '/docs', label: 'Docs', exact: false },
  { href: '/plans', label: 'Plans', exact: false },
  { href: '/account', label: 'Account', exact: false },
  { href: '/billing', label: 'Billing', exact: false },
];

function NavLink({
  href,
  label,
  exact,
  onNavigate,
  className = '',
}: (typeof NAV_LINKS)[number] & { onNavigate?: () => void; className?: string }) {
  const pathname = usePathname() ?? '';
  const active = exact ? pathname === href : pathname.startsWith(href);
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`rounded-md px-2 py-1 text-sm transition-colors hover:bg-black/[.04] dark:hover:bg-white/[.06] ${
        active
          ? 'font-semibold text-black dark:text-zinc-50'
          : 'text-zinc-600 dark:text-zinc-400'
      } ${className}`}
    >
      {label}
    </Link>
  );
}

/** "Log in" when signed out, "Sign out" when signed in. */
function AuthButton({
  onNavigate,
  fullWidth = false,
}: {
  onNavigate?: () => void;
  fullWidth?: boolean;
}) {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const width = fullWidth ? 'w-full' : '';

  if (isPending) {
    // Placeholder with the button's footprint so the header doesn't shift.
    return (
      <div
        aria-hidden="true"
        className={`h-9 ${fullWidth ? 'w-full' : 'w-20'} animate-pulse rounded-full bg-black/[.04] dark:bg-white/[.06]`}
      />
    );
  }

  if (session) {
    return (
      <button
        onClick={async () => {
          onNavigate?.();
          await signOut();
          router.push('/');
          router.refresh();
        }}
        className={`inline-flex h-9 items-center justify-center rounded-full border border-black/[.08] px-4 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-white/[.06] ${width}`}
      >
        Sign out
      </button>
    );
  }

  return (
    <Link
      href="/login"
      onClick={onNavigate}
      className={`inline-flex h-9 items-center justify-center rounded-full bg-[#635BFF] px-4 text-sm font-medium text-white transition-colors hover:bg-[#5348e8] ${width}`}
    >
      Log in
    </Link>
  );
}

export default function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="sticky top-0 z-40 border-b border-black/[.08] bg-white/90 backdrop-blur dark:border-white/[.145] dark:bg-black/90">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-6 px-6">
        <Link href="/" onClick={closeMenu} aria-label="Notetaskerator — home">
          <Logo />
        </Link>

        {/* Desktop nav */}
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <NavLink key={link.href} {...link} />
          ))}
        </nav>
        <div className="hidden md:block">
          <AuthButton />
        </div>

        {/* Mobile menu toggle */}
        <button
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
          className="-mr-2 rounded-md p-2 text-zinc-700 hover:bg-black/[.04] md:hidden dark:text-zinc-300 dark:hover:bg-white/[.06]"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            aria-hidden="true"
          >
            {menuOpen ? (
              <path d="M5 5l10 10M15 5L5 15" />
            ) : (
              <path d="M3 5.5h14M3 10h14M3 14.5h14" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <nav
          aria-label="Main"
          className="border-t border-black/[.08] px-6 py-4 md:hidden dark:border-white/[.145]"
        >
          <div className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.href}
                {...link}
                onNavigate={closeMenu}
                className="px-3 py-2 text-base"
              />
            ))}
          </div>
          <div className="mt-4">
            <AuthButton onNavigate={closeMenu} fullWidth />
          </div>
        </nav>
      )}
    </header>
  );
}
