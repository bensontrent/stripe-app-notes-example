import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { extractHeadings } from '@/services/markdoc/config';
import { getAllDocs, getDoc } from '@/services/markdoc/content';
import { DocBody } from '@/services/markdoc/DocBody';
import { TableOfContents } from '@/services/markdoc/TableOfContents';

/**
 * Public documentation pages, statically generated from src/content/docs.
 * /docs renders index.md; /docs/<name> renders <name>.md.
 */

type Params = { slug?: string[] };

export function generateStaticParams(): Params[] {
  return getAllDocs().map((doc) => ({ slug: doc.slug ? [doc.slug] : [] }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug = [] } = await params;
  const doc = getDoc(slug.join('/'));
  if (!doc) return {};
  return { title: `${doc.title} — Docs`, description: doc.description };
}

export default async function DocPage({ params }: { params: Promise<Params> }) {
  const { slug = [] } = await params;
  const doc = getDoc(slug.join('/'));
  if (!doc) notFound();

  const headings = extractHeadings(doc.body);
  return (
    <div className="flex gap-10">
      <article className="min-w-0 flex-1 pb-24">
        <h1 className="text-3xl font-semibold leading-10 tracking-tight">{doc.title}</h1>
        {doc.description && (
          <p className="mt-2 text-lg text-zinc-600 dark:text-zinc-400">{doc.description}</p>
        )}
        <DocBody source={doc.body} />
      </article>
      {headings.length > 0 && (
        <aside className="hidden w-56 shrink-0 xl:block">
          <TableOfContents headings={headings} />
        </aside>
      )}
    </div>
  );
}
