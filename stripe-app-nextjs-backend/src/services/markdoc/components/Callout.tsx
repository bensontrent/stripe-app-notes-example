const variants = {
  info: {
    container:
      'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40',
    title: 'text-blue-900 dark:text-blue-200',
    body: 'text-blue-800 dark:text-blue-300',
  },
  warning: {
    container:
      'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40',
    title: 'text-amber-900 dark:text-amber-200',
    body: 'text-amber-800 dark:text-amber-300',
  },
  error: {
    container:
      'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40',
    title: 'text-red-900 dark:text-red-200',
    body: 'text-red-800 dark:text-red-300',
  },
} as const;

/**
 * `{% callout type="warning" title="..." %}...{% /callout %}` — highlighted
 * note box for prerequisites, gotchas, and security caveats.
 */
export function Callout({
  type = 'info',
  title,
  children,
}: {
  type?: keyof typeof variants;
  title?: string;
  children: React.ReactNode;
}) {
  const variant = variants[type] ?? variants.info;
  return (
    <div className={`my-6 rounded-xl border p-4 text-sm ${variant.container}`}>
      {title && <p className={`mb-1 font-semibold ${variant.title}`}>{title}</p>}
      <div className={`docs-callout-body ${variant.body}`}>{children}</div>
    </div>
  );
}
