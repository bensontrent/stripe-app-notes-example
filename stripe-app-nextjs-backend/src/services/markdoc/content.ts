import Markdoc from '@markdoc/markdoc';
import matter from 'gray-matter';
import fs from 'node:fs';
import path from 'node:path';
import { cache } from 'react';
import { markdocConfig } from './config';

/**
 * Reads src/content/docs into a validated, ordered list. Flat by design:
 * index.md is the docs landing page (/docs); every other name.md becomes
 * /docs/name. Files starting with "_" and drafts (`draft: true`) are
 * skipped.
 *
 * Every document's frontmatter and Markdoc body (unknown tags, missing
 * attributes) are validated here — so bad content fails `next build`
 * instead of shipping.
 */

const CONTENT_DIR = path.join(process.cwd(), 'src', 'content', 'docs');

export type Doc = {
  /** URL segment after /docs; '' for index.md. */
  slug: string;
  href: string;
  title: string;
  description?: string;
  /** Sidebar position (frontmatter `order`, then title). */
  order: number;
  body: string;
};

function parseFile(filePath: string, slug: string): Doc | null {
  const raw = fs.readFileSync(filePath, 'utf8');
  const { data, content } = matter(raw);

  if (typeof data.title !== 'string' || data.title.length === 0) {
    throw new Error(`Missing "title" frontmatter in ${filePath}`);
  }
  if (data.draft === true) return null;

  const errors = Markdoc.validate(Markdoc.parse(content), markdocConfig).filter(
    (e) => e.error.level === 'error' || e.error.level === 'critical',
  );
  if (errors.length > 0) {
    throw new Error(
      `Invalid Markdoc in ${filePath}:\n${errors
        .map((e) => `  line ${e.lines?.[0] ?? '?'}: ${e.error.message}`)
        .join('\n')}`,
    );
  }

  return {
    slug,
    href: slug ? `/docs/${slug}` : '/docs',
    title: data.title,
    description: typeof data.description === 'string' ? data.description : undefined,
    order: typeof data.order === 'number' ? data.order : Number.MAX_SAFE_INTEGER,
    body: content.trim(),
  };
}

function readDocs(): Doc[] {
  const docs: Doc[] = [];
  for (const entry of fs.readdirSync(CONTENT_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith('_') || !entry.name.endsWith('.md')) {
      continue;
    }
    const slug = entry.name === 'index.md' ? '' : entry.name.replace(/\.md$/, '');
    const doc = parseFile(path.join(CONTENT_DIR, entry.name), slug);
    if (doc) docs.push(doc);
  }
  docs.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  return docs;
}

/** Every published doc, in sidebar order (index.md first by convention). */
export const getAllDocs = cache(readDocs);

export function getDoc(slug: string): Doc | undefined {
  return getAllDocs().find((d) => d.slug === slug);
}
