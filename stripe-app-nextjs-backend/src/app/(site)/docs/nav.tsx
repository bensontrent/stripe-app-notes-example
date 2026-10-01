'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Docs sidebar. A client component only for the active-page highlight;
 * the list itself comes from the server layout (src/content/docs).
 */
export function DocsNav({ items }: { items: { href: string; title: string }[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Documentation" className="sticky top-24">
      <h2 className="text-xs font-semibold uppercase tracking-wider">Documentation</h2>
      <ul className="mt-4 space-y-2">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`block rounded-md px-2 py-1 text-sm hover:bg-black/[.04] dark:hover:bg-white/[.06] ${
                  active
                    ? 'bg-black/[.04] font-semibold dark:bg-white/[.06]'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                {item.title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
