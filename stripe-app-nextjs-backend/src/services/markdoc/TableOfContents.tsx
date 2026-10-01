'use client';

import type { DocHeading } from './config';
import { useEffect, useState } from 'react';

/** Viewport offset matching the sticky header clearance (top-24 = 6rem). */
const HEADER_OFFSET = 96;

/**
 * Right rail on doc pages: the document's h2/h3 headings as anchor links,
 * so long pages read as a guided outline. The heading currently being read
 * is highlighted as the user scrolls. Desktop-only (hidden below xl by the
 * page layout).
 */
export function TableOfContents({ headings }: { headings: DocHeading[] }) {
  const activeId = useActiveHeading(headings);

  return (
    <nav aria-label="On this page" className="sticky top-24">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-black dark:text-zinc-50">
        On this page
      </h2>
      <ul className="mt-4 space-y-3">
        {headings.map((h, i) => (
          <li
            key={`${h.id}-${i}`}
            className={
              h.level === 3
                ? 'border-l-2 border-black/10 pl-3 dark:border-white/15'
                : undefined
            }
          >
            <a
              href={`#${h.id}`}
              aria-current={h.id === activeId ? 'true' : undefined}
              className={`block text-sm hover:text-black dark:hover:text-zinc-50 ${
                h.id === activeId
                  ? 'font-semibold text-black dark:text-zinc-50'
                  : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              {h.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Id of the heading the reader is currently on: the topmost heading visible
 * below the sticky header, or — when a section is taller than the viewport
 * and no heading is on screen — the last heading scrolled past. When the
 * page is scrolled all the way down the last heading wins, since a short
 * final section could otherwise never reach the top of the viewport.
 */
function useActiveHeading(headings: DocHeading[]) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const elements = headings
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    // Zero-height sentinel at the end of the document; it intersects only
    // when the page can scroll no further.
    const sentinel = document.createElement('div');
    document.body.appendChild(sentinel);

    const visible = new Set<string>();
    let atBottom = false;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === sentinel) atBottom = entry.isIntersecting;
          else if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        if (atBottom) {
          setActiveId(elements[elements.length - 1].id);
          return;
        }
        const topmost = elements.find((el) => visible.has(el.id));
        if (topmost) {
          setActiveId(topmost.id);
        } else {
          const above = elements.filter(
            (el) => el.getBoundingClientRect().top < HEADER_OFFSET,
          );
          setActiveId(above.length > 0 ? above[above.length - 1].id : null);
        }
      },
      { rootMargin: `-${HEADER_OFFSET}px 0px 0px 0px` },
    );
    for (const el of elements) observer.observe(el);
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
      sentinel.remove();
    };
  }, [headings]);

  return activeId;
}
