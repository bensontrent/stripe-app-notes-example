/**
 * `{% steps %}{% step title="Install" %}...{% /step %}{% /steps %}` —
 * numbered setup steps. Numbering comes from a CSS counter (see .docs-steps
 * in globals.css) so steps can be reordered freely.
 */
export function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="docs-steps my-6 list-none space-y-6 p-0">{children}</ol>;
}

export function Step({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <li className="relative pl-12">
      <span
        aria-hidden
        className="docs-step-number absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full border-2 border-zinc-400 font-mono text-sm font-semibold text-zinc-700 dark:border-zinc-600 dark:text-zinc-300"
      />
      <h3 className="mt-0 text-base font-semibold text-black dark:text-zinc-50">{title}</h3>
      {children && (
        <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{children}</div>
      )}
    </li>
  );
}
