'use client';

// Small form primitives shared by the (login) pages. This file exports no
// route, so the App Router ignores it.

import { useSyncExternalStore } from 'react';

const subscribeNever = () => () => {};

/**
 * Was this page opened as a popup/new tab (so window.close() will work)?
 * useSyncExternalStore reads the value SSR-safely: false during prerender,
 * the real answer on the client.
 */
export function useCanCloseWindow(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => window.opener != null || window.history.length === 1,
    () => false,
  );
}

export function AuthTitle({ children }: { children: React.ReactNode }) {
  return <h1 className="text-2xl font-bold text-center mb-6">{children}</h1>;
}

export function AuthField({
  id,
  label,
  ...inputProps
}: { id: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-sm font-medium text-gray-700 mb-1"
      >
        {label}
      </label>
      <input
        id={id}
        className="w-full px-3 py-2 bg-white text-gray-900 placeholder:text-gray-500 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        {...inputProps}
      />
    </div>
  );
}

export function AuthButton({
  children,
  variant = 'primary',
  ...buttonProps
}: {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500',
    secondary:
      'bg-gray-100 text-gray-800 hover:bg-gray-200 focus:ring-gray-400',
    danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
  } as const;

  return (
    <button
      className={`w-full py-2 px-4 rounded-md focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed transition ${styles[variant]}`}
      {...buttonProps}
    >
      {children}
    </button>
  );
}

export function AuthError({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return <div className="text-red-600 text-sm text-center">{children}</div>;
}

export function AuthInfo({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-blue-50 border border-blue-200 text-blue-900 text-sm rounded-md p-3">
      {children}
    </div>
  );
}
