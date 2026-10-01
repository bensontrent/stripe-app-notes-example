// Site logo: a Stripe-purple app-grid mark next to a two-line wordmark.
// Pure inline SVG + text so it needs no image assets and inherits dark mode
// from the surrounding Tailwind classes.
export default function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <svg
        width="28"
        height="28"
        viewBox="0 0 28 28"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect width="28" height="28" rx="7" fill="#635BFF" />
        <rect x="6" y="6" width="7" height="7" rx="2" fill="#fff" />
        <rect x="15" y="6" width="7" height="7" rx="2" fill="#fff" fillOpacity="0.8" />
        <rect x="6" y="15" width="7" height="7" rx="2" fill="#fff" fillOpacity="0.8" />
        <circle cx="18.5" cy="18.5" r="3.5" fill="#fff" />
      </svg>
      <span className="flex flex-col text-left leading-tight">
        <span className="text-sm font-semibold text-black dark:text-zinc-50">
          Notetaskerator
        </span>
        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
          Notes and tasks for Stripe
        </span>
      </span>
    </span>
  );
}
