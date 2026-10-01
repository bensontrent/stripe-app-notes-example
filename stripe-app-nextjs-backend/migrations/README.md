# Database migrations

Every change to the database schema is a new `.sql` file in this folder.
[`setup.sql`](../setup.sql) is the baseline and is not edited any more: the
current schema is `setup.sql` plus every file here, in filename order.

```bash
npm run db:setup
```

applies `setup.sql`, then each file in this folder that the database hasn't
had yet, and records it in the `applied_migrations` table. Fresh installs and
databases that already hold data take the same path, so a change you ship
reaches both.

## Adding one

1. Create `YYYYMMDDHHMMSS_what_it_does.sql` — a UTC timestamp, then a
   description in lowercase letters, digits and `_`. The timestamp is the
   order the files run in; `db:setup` refuses a `.sql` file named any other way.
2. Write plain SQL.
3. Run `npm run db:setup`, then commit the file with the code that needs it.

```sql
-- migrations/20261005143000_add_api_keys.sql
CREATE TABLE "api_keys" (
	"key_hash" text PRIMARY KEY,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "api_keys_user_id_idx" ON "api_keys" ("user_id");
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
```

## Rules

- **Never edit or rename a file that has been applied anywhere.** It won't run
  again, so databases would drift apart. Fix a mistake with a new migration.
- **Leave names unqualified** (`"api_keys"`, not `"public"."api_keys"`).
  `db:setup` points `search_path` at `SUPABASE_SCHEMA`, which is how one file
  serves `public` and a dedicated schema alike.
- **Enable Row Level Security on every new table**, with no policies.
  Supabase's REST API exposes the schema to the publishable key; the backend
  uses the secret key, which bypasses RLS.
- **No `BEGIN` / `COMMIT`.** Each file already runs in one transaction: it
  applies completely or not at all, and a failure stops the run before the
  files after it. (So nothing that can't run inside a transaction, such as
  `CREATE INDEX CONCURRENTLY`.)
- **Changing a function's arguments** needs `DROP FUNCTION` for the old
  signature first; `CREATE OR REPLACE` with different arguments adds a second
  function instead of replacing the first.
- Changing one of the four Better Auth tables (`users`, `sessions`,
  `auth_accounts`, `verifications`)? Update the field maps in
  `src/lib/auth.ts` in the same commit.

## Without the CLI

`npm run db:setup -- --print` prints the SQL a **fresh** database needs
(`setup.sql`, every migration, and the `applied_migrations` rows) for pasting
into the Supabase SQL editor. For a database that already has the tables,
paste only the new migration file and record it, so `db:setup` doesn't apply
it a second time later (with a dedicated schema, put
`SET search_path TO "your_schema";` on the first line):

```sql
INSERT INTO "applied_migrations" ("name") VALUES ('20261005143000_add_api_keys.sql');
```
