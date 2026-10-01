import SiteHeader from '@/components/SiteHeader';

// Shared shell for the public site pages — home, /docs, /account — with the
// sticky responsive nav bar. The (login) group keeps its own minimal
// centered-card layout because several of its pages open as popups from the
// Stripe Dashboard. The group name doesn't appear in URLs, so src/proxy.ts
// route lists are unaffected.
export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white font-sans text-black dark:bg-black dark:text-zinc-50">
      <SiteHeader />
      {children}
    </div>
  );
}
