import { getAllDocs } from '@/services/markdoc/content';
import { DocsNav } from './nav';

/**
 * Shell for the public /docs pages: left sidebar built from the content tree
 * (src/content/docs) plus the page content. The sticky site-wide nav bar
 * comes from the parent (site) layout. The route is public — /docs is listed
 * in PUBLIC_ROUTES in src/proxy.ts.
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const docs = getAllDocs();
  return (
    <div className="mx-auto flex max-w-6xl gap-10 px-6 py-10">
      <aside className="hidden w-56 shrink-0 lg:block">
        <DocsNav
          items={docs.map(({ href, title }) => ({ href, title }))}
        />
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
