-- Notes and tasks (src/lib/notes.ts, the /api/stripe-app/notes routes) and
-- the team directory they are assigned from (src/lib/account-users.ts).

-- ============================================================================
--  account_users — the people who have opened the app in a Stripe account
-- ============================================================================

-- Stripe gives an app no list of an account's team members; it only tells
-- the app who is looking at it right now. So the app "checks in" each time a
-- view opens (POST /api/stripe-app/team) and this table remembers everyone
-- who ever did. It is the list a task can be assigned to, and where the
-- assignment email finds an address.
--
-- The ids are covered by the Stripe App signature. name and email are NOT:
-- they are what the app read from the Dashboard's user context and reported,
-- so treat them as display data, never as proof of identity.
--
-- One row per person per account, not per mode: the same teammate works in
-- test and live mode. Rows are never deleted — notes keep pointing at their
-- author and assignee.
CREATE TABLE "account_users" (
	"stripe_account_id" text NOT NULL REFERENCES "stripe_accounts"("id") ON DELETE CASCADE,
	"stripe_user_id" text NOT NULL,
	"name" text,
	"email" text,
	"first_seen_at" timestamptz NOT NULL DEFAULT now(),
	"last_seen_at" timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT "account_users_pkey" PRIMARY KEY ("stripe_account_id", "stripe_user_id")
);
ALTER TABLE "account_users" ENABLE ROW LEVEL SECURITY;

-- ============================================================================
--  notes — a note on a customer, invoice or payment; optionally a task
-- ============================================================================

-- Every note belongs to one Stripe account and one mode (test-mode notes and
-- live-mode notes never mix: the objects they are attached to differ too).
--
--   object_type / object_id   what the note is attached to. 'payment' covers
--                             both pi_… and ch_… ids — whichever the
--                             Dashboard's payment page is showing.
--   customer_id               the customer the object belongs to (the
--                             customer itself for a customer note). The
--                             customer page lists by this column, so it also
--                             shows notes written on that customer's invoices
--                             and payments. NULL for a payment or invoice
--                             without a customer.
--   object_label,             what to call the object and the customer in
--   customer_label            lists ("Invoice ABC-0001", "Jane Doe"). Saved
--                             when the note is written, reported by the app:
--                             the backend never reads the installing
--                             account's Stripe data.
--
-- A note becomes a task when is_task is true; priority, status and assignee
-- only mean something then. priority is a number so "most urgent first" is a
-- plain ORDER BY: 1 low, 2 normal, 3 high, 4 urgent.
--
-- The assignee must be someone in the same account's account_users — the
-- composite foreign key makes assigning across accounts impossible, whatever
-- a request says. created_by / updated_by are Dashboard user ids too ('' for
-- a caller without one) but carry no foreign key.
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"stripe_account_id" text NOT NULL REFERENCES "stripe_accounts"("id") ON DELETE CASCADE,
	"livemode" boolean NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"customer_id" text,
	"object_label" text,
	"customer_label" text,
	"body" text NOT NULL,
	"is_task" boolean NOT NULL DEFAULT false,
	"priority" smallint NOT NULL DEFAULT 2,
	"status" text NOT NULL DEFAULT 'open',
	"assignee_stripe_user_id" text,
	"created_by" text NOT NULL DEFAULT '',
	"updated_by" text NOT NULL DEFAULT '',
	"resolved_at" timestamptz,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	"updated_at" timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT "notes_object_type_check" CHECK ("object_type" IN ('customer', 'invoice', 'payment')),
	CONSTRAINT "notes_priority_check" CHECK ("priority" BETWEEN 1 AND 4),
	CONSTRAINT "notes_status_check" CHECK ("status" IN ('open', 'in_progress', 'resolved')),
	CONSTRAINT "notes_body_check" CHECK (char_length("body") BETWEEN 1 AND 5000),
	CONSTRAINT "notes_assignee_fkey" FOREIGN KEY ("stripe_account_id", "assignee_stripe_user_id")
		REFERENCES "account_users" ("stripe_account_id", "stripe_user_id")
);

-- The notes on one object (invoice and payment pages).
CREATE INDEX "notes_object_idx" ON "notes" ("stripe_account_id", "livemode", "object_type", "object_id");
-- Everything about one customer (customer page).
CREATE INDEX "notes_customer_idx" ON "notes" ("stripe_account_id", "livemode", "customer_id");
-- The task queue (dashboard): open tasks, most urgent first, oldest first.
CREATE INDEX "notes_task_queue_idx" ON "notes" ("stripe_account_id", "livemode", "status", "priority" DESC, "created_at")
	WHERE "is_task";
-- "Assigned to me", and the foreign key's own lookups.
CREATE INDEX "notes_assignee_idx" ON "notes" ("stripe_account_id", "assignee_stripe_user_id");

ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY;
