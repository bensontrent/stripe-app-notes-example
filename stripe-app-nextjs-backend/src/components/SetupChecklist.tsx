import type { ReactNode } from 'react';
import { envSource, isConfigured } from '@/lib/env';

// First-run setup checklist shown on the home page of the dev server. It
// never renders in production builds, and disappears on its own once every
// item is green. Each item explains how to fix itself.

type Status = 'done' | 'todo' | 'optional';

interface Item {
    status: Status;
    label: string;
    detail?: string;
    fix: ReactNode;
}

async function probeDatabase(schema: string) {
    try {
        const { Client } = await import('pg');
        const client = new Client({
            connectionString: process.env.DATABASE_URL,
            connectionTimeoutMillis: 5000,
        });
        await client.connect();
        try {
            const { rows } = await client.query(
                `select 1 from information_schema.tables
                 where table_schema = $1 and table_name = 'users'`,
                [schema],
            );
            return { connected: true, hasTables: rows.length > 0, error: undefined };
        } finally {
            await client.end();
        }
    } catch (err) {
        return {
            connected: false,
            hasTables: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

// For a dedicated SUPABASE_SCHEMA only: checks that supabase-js can actually
// query the schema through Supabase's REST API. This fails until the schema
// is added to "Exposed schemas" in the dashboard — a step SQL can't automate.
async function probeSupabaseRest(schema: string) {
    try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL as string,
            process.env.SUPABASE_SERVICE_ROLE_KEY as string,
            { db: { schema }, auth: { persistSession: false } },
        );
        const { error } = await supabase.from('users').select('id', { head: true, count: 'exact' });
        return { ok: !error, error: error?.message };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

function Code({ children }: { children: ReactNode }) {
    return (
        <code className="rounded bg-black/[.06] px-1.5 py-0.5 font-mono text-[13px] dark:bg-white/[.12]">
            {children}
        </code>
    );
}

// " (from SUPABASE_POOLER_URL)" when Stripe Projects provided the value.
function from(name: Parameters<typeof envSource>[0]): string {
    const source = envSource(name);
    return source && source !== name ? ` (from ${source})` : '';
}

const ICONS: Record<Status, ReactNode> = {
    done: <span className="w-4 shrink-0 text-green-600 dark:text-green-400">✓</span>,
    todo: <span className="w-4 shrink-0 text-red-500 dark:text-red-400">✗</span>,
    optional: <span className="w-4 shrink-0 text-zinc-400">○</span>,
};

export default async function SetupChecklist() {
    if (process.env.NODE_ENV === 'production') return null;

    const env = process.env;
    const schema = env.SUPABASE_SCHEMA || 'public';
    const dbConfigured = isConfigured(env.DATABASE_URL);
    const viaProjects = Boolean(envSource('DATABASE_URL') && envSource('DATABASE_URL') !== 'DATABASE_URL');
    const supabaseKeysConfigured =
        isConfigured(env.NEXT_PUBLIC_SUPABASE_URL) && isConfigured(env.SUPABASE_SERVICE_ROLE_KEY);
    const db = dbConfigured
        ? await probeDatabase(schema)
        : { connected: false, hasTables: false, error: undefined };
    // The exposure check only matters for a dedicated schema (public is
    // exposed out of the box), and is only meaningful once keys + tables exist.
    const rest =
        schema !== 'public' && supabaseKeysConfigured && db.hasTables
            ? await probeSupabaseRest(schema)
            : { ok: false, error: undefined };

    const items: Item[] = [
        {
            status: dbConfigured && db.connected ? 'done' : 'todo',
            label: dbConfigured
                ? `Database reachable${from('DATABASE_URL')}`
                : 'Database connection (DATABASE_URL)',
            detail: db.error,
            fix: (
                <>
                    Run <Code>npm run setup</Code> — it asks for your Supabase project&apos;s connection
                    string (click <em>Connect</em> in the project toolbar and copy the{' '}
                    <em>Session pooler</em> string; replace <Code>[YOUR-PASSWORD]</Code>), or can create
                    a free project at{' '}
                    <a className="underline" href="https://database.new" target="_blank" rel="noreferrer">
                        database.new
                    </a>{' '}
                    with you. Or set <Code>DATABASE_URL</Code> in <Code>.env.local</Code> yourself.
                    Alternative: <Code>stripe projects add supabase/project</Code> provisions a brand-new
                    project through Stripe Projects and writes <Code>SUPABASE_POOLER_URL</Code> to{' '}
                    <Code>.env</Code>. Then restart the dev server.
                </>
            ),
        },
        {
            status: supabaseKeysConfigured ? 'done' : 'todo',
            label: supabaseKeysConfigured
                ? `Supabase API URL${from('NEXT_PUBLIC_SUPABASE_URL')} and secret key${from('SUPABASE_SERVICE_ROLE_KEY')}`
                : 'Supabase API URL and secret key (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)',
            fix: viaProjects ? (
                <>
                    Stripe Projects wrote <Code>SUPABASE_PROJECT_URL</Code> to <Code>.env</Code>, but the{' '}
                    <em>secret key</em> (<Code>sb_secret_…</Code>, formerly <Code>service_role</Code>)
                    may not be included. Open the project (<Code>stripe projects open supabase</Code>{' '}
                    → <em>Project Settings → API Keys</em>), copy it, and either put it in{' '}
                    <Code>.env.local</Code> as <Code>SUPABASE_SECRET_KEY</Code> or store it for the
                    whole team with{' '}
                    <Code>
                        stripe projects variables set supabase-secret-key --env-key SUPABASE_SECRET_KEY
                    </Code>
                    .
                </>
            ) : (
                <>
                    In the Supabase dashboard open <em>Project Settings → API Keys</em> and copy the
                    project URL and the secret (<Code>service_role</Code>) key into{' '}
                    <Code>.env.local</Code> — <Code>npm run setup</Code> asks for both. The backend
                    uses them for all data access.
                </>
            ),
        },
        {
            status: db.hasTables ? 'done' : 'todo',
            label:
                schema === 'public'
                    ? 'Database tables created'
                    : `Database tables created in schema “${schema}”`,
            fix: (
                <>
                    Run <Code>npm run setup</Code> (or <Code>npm run db:setup</Code>)
                    {schema === 'public' ? (
                        <>
                            {' '}
                            — or paste <Code>setup.sql</Code> into the Supabase SQL editor
                        </>
                    ) : (
                        <>
                            {' '}
                            — it creates the <Code>{schema}</Code> schema, installs the tables there
                            and grants the Supabase API roles access. Prefer the SQL editor? Run{' '}
                            <Code>npm run db:setup -- --print</Code> and paste its output instead
                        </>
                    )}
                    .
                </>
            ),
        },
        ...(schema !== 'public'
            ? [
                {
                    status: (rest.ok ? 'done' : 'todo') as Status,
                    label: `Schema “${schema}” exposed to the Supabase API`,
                    detail: rest.error,
                    fix: (
                        <>
                            In the Supabase dashboard open <em>Settings → API</em> and add{' '}
                            <Code>{schema}</Code> to <em>Exposed schemas</em>, then reload this
                            page. Until then <Code>supabase-js</Code> can&apos;t query the schema
                            even though the tables exist. (This check runs once the API keys are
                            set and the tables are created.)
                        </>
                    ),
                },
            ]
            : []),
        {
            status:
                isConfigured(env.BETTER_AUTH_SECRET) && env.BETTER_AUTH_SECRET.length >= 32
                    ? 'done'
                    : 'todo',
            label: 'Auth secret (BETTER_AUTH_SECRET)',
            fix: (
                <>
                    <Code>npm run setup</Code> generates it, or set any random string of 32+ characters
                    in <Code>.env.local</Code>.
                </>
            ),
        },
        {
            status: (['BEARER_TOKEN_KEYS', 'DEV_API_KEY', 'CRON_SECRET'] as const).every(
                (key) => isConfigured(env[key]),
            )
                ? 'done'
                : 'todo',
            label: 'Proxy secrets (BEARER_TOKEN_KEYS, DEV_API_KEY, CRON_SECRET)',
            fix: (
                <>
                    <Code>npm run setup</Code> generates all three; see <Code>.env.example</Code> for
                    what each one protects.
                </>
            ),
        },
        {
            status:
                isConfigured(env.STRIPE_SECRET_KEY_TEST) && /^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY_TEST)
                    ? 'done'
                    : 'todo',
            label: 'Stripe test key (STRIPE_SECRET_KEY_TEST)',
            fix: (
                <>
                    <Code>npm run setup</Code> copies it from your <Code>stripe login</Code> session. Or
                    paste the test-mode secret key from{' '}
                    <a
                        className="underline"
                        href="https://dashboard.stripe.com/test/apikeys"
                        target="_blank"
                        rel="noreferrer"
                    >
                        dashboard.stripe.com/test/apikeys
                    </a>{' '}
                    into <Code>.env.local</Code>.
                </>
            ),
        },
        {
            status: isConfigured(env.STRIPE_WEBHOOK_SECRET_TEST_CONNECTED) ? 'done' : 'todo',
            label: 'Webhook secret (STRIPE_WEBHOOK_SECRET_TEST_CONNECTED)',
            fix: (
                <>
                    In a separate terminal run{' '}
                    <Code>
                        {'stripe listen --forward-connect-to "localhost:3006/api/webhooks/app?mode=test&type=connected" --forward-to "localhost:3006/api/webhooks/billing?mode=test"'}
                    </Code>{' '}
                    and copy
                    the printed <Code>whsec_…</Code> value into <Code>.env.local</Code>.
                </>
            ),
        },
        {
            status:
                isConfigured(env.STRIPE_APP_SIGNING_SECRET) && /^absec_/.test(env.STRIPE_APP_SIGNING_SECRET)
                    ? 'done'
                    : 'optional',
            label: 'Stripe App signing secret (STRIPE_APP_SIGNING_SECRET)',
            fix: (
                <>
                    This secret only exists after your first <Code>stripe apps upload</Code>{' '}
                    (uploading is not publishing — the app stays private to your account). Copy the
                    “Signing secret” from your app’s page in the Stripe Developers Dashboard into{' '}
                    <Code>.env.local</Code>. Until then, signed requests from the app’s UI extension
                    will fail.
                </>
            ),
        },
    ];

    const done = items.filter((item) => item.status === 'done').length;
    if (done === items.length) return null;
    const requiredDone = items.every((item) => item.status !== 'todo');

    return (
        <section className="w-full rounded-2xl border border-amber-300/60 bg-amber-50 p-6 text-left text-sm dark:border-amber-400/20 dark:bg-amber-950/20">
            <div className="mb-1 flex items-baseline justify-between gap-4">
                <h2 className="text-base font-semibold text-black dark:text-zinc-50">
                    First-time setup checklist
                </h2>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {done}/{items.length} done
                </span>
            </div>
            <p className="mb-4 text-zinc-600 dark:text-zinc-400">
                {requiredDone ? (
                    'Everything required is configured — only optional items remain.'
                ) : (
                    <>
                        Fastest path: run <Code>npm run setup</Code> — it walks you through connecting
                        Supabase and fills in the rest. Or expand any item for instructions. The page
                        re-checks on every reload.
                    </>
                )}
            </p>
            <ul className="flex flex-col gap-2">
                {items.map((item) => (
                    <li key={item.label}>
                        {item.status === 'done' ? (
                            <p className="flex gap-2 text-zinc-700 dark:text-zinc-300">
                                {ICONS.done}
                                <span>{item.label}</span>
                            </p>
                        ) : (
                            <details>
                                <summary className="flex cursor-pointer gap-2 text-zinc-800 dark:text-zinc-200">
                                    {ICONS[item.status]}
                                    <span>
                                        {item.label}
                                        {item.status === 'optional' ? (
                                            <span className="text-zinc-400"> — can wait</span>
                                        ) : null}
                                    </span>
                                </summary>
                                <div className="mt-1 pl-6 text-zinc-600 dark:text-zinc-400">
                                    {item.fix}
                                    {item.detail ? (
                                        <p className="mt-1 font-mono text-xs text-red-500/80">{item.detail}</p>
                                    ) : null}
                                </div>
                            </details>
                        )}
                    </li>
                ))}
            </ul>
            <p className="mt-4 border-t border-amber-300/40 pt-3 text-xs text-zinc-500 dark:border-amber-400/10 dark:text-zinc-400">
                This panel only appears on the dev server and goes away by itself once every item is
                green. Edits to <Code>.env</Code> and <Code>.env.local</Code> are picked up
                automatically; reload this page to re-check.
            </p>
        </section>
    );
}
