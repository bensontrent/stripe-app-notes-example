import Link from 'next/link';
import SetupChecklist from '@/components/SetupChecklist';

// Home page. The setup checklist only renders on the dev server while
// something is still missing — once the project is configured, visitors just
// see the hero and feature overview.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-12 px-6 py-12 sm:py-20">
      <SetupChecklist />

      <section className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">
        <span className="rounded-full border border-black/[.08] px-3 py-1 text-xs font-medium text-zinc-600 dark:border-white/[.145] dark:text-zinc-400">
          A Stripe App for support teams
        </span>
        <h1 className="max-w-2xl text-3xl font-semibold leading-tight tracking-tight text-black sm:text-4xl dark:text-zinc-50">
          Notes and tasks, right where your customers are
        </h1>
        <p className="max-w-2xl text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Notetaskerator adds notes to every customer, invoice and payment in your
          Stripe Dashboard. Turn a note into a task, give it a priority, assign it
          to a teammate, and work through one shared queue.
        </p>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Link
            href="/docs"
            className="inline-flex h-11 items-center justify-center rounded-full bg-[#635BFF] px-6 text-sm font-medium text-white transition-colors hover:bg-[#5348e8]"
          >
            Read the guide
          </Link>
          <Link
            href="/plans"
            className="inline-flex h-11 items-center justify-center rounded-full border border-black/[.08] px-6 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-white/[.06]"
          >
            Plans and pricing
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          {
            title: 'Notes in context',
            body: 'Write a note on a customer, invoice or payment page. A customer’s page shows everything written about them, including notes on their invoices and payments.',
          },
          {
            title: 'Tasks with an owner',
            body: 'A note becomes a task with one click: set a priority, pick a teammate, and they get an email. Resolve it when it is done.',
          },
          {
            title: 'One queue for the team',
            body: 'The full-page view lists every open task, most urgent first, with filters for what is assigned to you and what nobody has picked up.',
          },
        ].map((feature) => (
          <div
            key={feature.title}
            className="rounded-2xl border border-black/[.08] p-6 dark:border-white/[.145]"
          >
            <h2 className="text-base font-semibold text-black dark:text-zinc-50">
              {feature.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              {feature.body}
            </p>
          </div>
        ))}
      </section>
    </main>
  );
}
