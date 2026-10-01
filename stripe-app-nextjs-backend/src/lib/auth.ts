import { betterAuth } from 'better-auth';
import { Pool } from 'pg';
// Maps SUPABASE_POOLER_URL / SUPABASE_DB_URL onto DATABASE_URL when Supabase was
// provisioned through Stripe Projects. See src/lib/env.ts.
import './env';
import { escapeHtml, sendEmail } from './email';
import { dbSchema } from './supabase';

// Better Auth manages its own tables (users, sessions, auth_accounts,
// verifications) and needs a direct Postgres connection to do it — Supabase
// is just Postgres, so a plain `pg` Pool on DATABASE_URL is all it takes.
// The tables themselves are created by setup.sql.
//
// The modelName/fields blocks map Better Auth's default camelCase names onto
// the snake_case tables in setup.sql. Everything else in the app talks to
// the database through the Supabase client (src/lib/supabase.ts).
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// When SUPABASE_SCHEMA points at a dedicated schema, aim every connection's
// search_path there so Better Auth finds its tables. (dbSchema is validated
// as a plain identifier in src/lib/supabase.ts. Use the Session pooler
// connection string — the transaction pooler doesn't keep per-connection
// settings like search_path.)
if (dbSchema !== 'public') {
  pool.on('connect', (client) => {
    void client.query(`set search_path to "${dbSchema}"`);
  });
}

export const auth = betterAuth({
  database: pool,
  user: {
    modelName: 'users',
    fields: {
      emailVerified: 'email_verified',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  session: {
    modelName: 'sessions',
    fields: {
      userId: 'user_id',
      expiresAt: 'expires_at',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  // Better Auth's "account" model is a sign-in method (credential or OAuth
  // provider), stored in auth_accounts. It is unrelated to Stripe accounts.
  account: {
    modelName: 'auth_accounts',
    fields: {
      userId: 'user_id',
      accountId: 'account_id',
      providerId: 'provider_id',
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      idToken: 'id_token',
      accessTokenExpiresAt: 'access_token_expires_at',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  verification: {
    modelName: 'verifications',
    fields: {
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    // The /reset-password page calls authClient.requestPasswordReset() with
    // redirectTo: '/confirm'; Better Auth then asks us to deliver the link.
    // The link is emailed through Postmark (src/lib/email.ts) when
    // POSTMARK_SERVER_API_TOKEN and POSTMARK_FROM_EMAIL are set. Without
    // them — or when sending fails under `next dev` — it is printed to the
    // backend terminal, so the flow works before email is configured.
    sendResetPassword: async ({ user, url }) => {
      const result = await sendEmail({
        to: user.email,
        subject: 'Reset your password',
        text:
          `Someone asked to reset the password for ${user.email}.\n\n` +
          `Choose a new password: ${url}\n\n` +
          `If that wasn't you, ignore this email — your password stays the same.`,
        html:
          `<p>Someone asked to reset the password for ${escapeHtml(user.email)}.</p>` +
          `<p><a href="${escapeHtml(url)}">Choose a new password</a></p>` +
          `<p>If that wasn't you, ignore this email — your password stays the same.</p>`,
      });

      if (result.status === 'sent') {
        console.log(`[auth] Password reset email sent to ${user.email}`);
        return;
      }
      if (result.status === 'failed') {
        console.error(`[auth] Password reset email failed: ${result.error}`);
        // Never print a working reset link into production logs.
        if (process.env.NODE_ENV !== 'development') return;
      }
      console.log(`[auth] Password reset link for ${user.email}: ${url}`);
    },
  },
  socialProviders: {},
  advanced: {
    database: {
      generateId: () => crypto.randomUUID(),
    }
  },
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL!,
});

export type Auth = typeof auth;
