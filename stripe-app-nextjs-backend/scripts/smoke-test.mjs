// scripts/smoke-test.mjs — `npm run smoke`
//
// End-to-end check of the notes API against a RUNNING backend (`npm run dev`)
// and the real database. It signs its requests the way the Stripe App does —
// with STRIPE_APP_SIGNING_SECRET from .env.local — so everything behind the
// proxy runs for real: signature check, validation, paywall, tenant scoping,
// the assignment email decision.
//
// It works in three made-up Stripe accounts (acct_smoketest…) and deletes
// every row it created when it finishes, pass or fail. Nothing is printed
// from .env.local.
//
//   npm run dev        (one terminal)
//   npm run smoke      (another)
//
// Options: SMOKE_BASE_URL (default https://localhost:3006).

import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import Stripe from 'stripe';
import { loadEnv } from './env.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(root);

const BASE = process.env.SMOKE_BASE_URL || 'https://localhost:3006';
const SECRET = process.env.STRIPE_APP_SIGNING_SECRET;
const SCHEMA = process.env.SUPABASE_SCHEMA || 'public';

if (!SECRET) {
  console.error('STRIPE_APP_SIGNING_SECRET is not set in .env.local — nothing to sign requests with.');
  process.exit(1);
}

// Signing is pure HMAC math; the key is never sent anywhere.
const stripe = new Stripe('sk_placeholder_signing_only');

const run = randomBytes(4).toString('hex');
const ACCOUNT_A = `acct_smoketest${run}A`;
const ACCOUNT_B = `acct_smoketest${run}B`;
const ALICE = `usr_smoketest${run}alice`;
const BOB = `usr_smoketest${run}bob`;
const CAROL = `usr_smoketest${run}carol`; // works in account B only
const CUSTOMER = `cus_smoketest${run}`;
const INVOICE = `in_smoketest${run}`;
const PAYMENT = `pi_smoketest${run}`;

/** A request signed as `user` in `account`, like fetchStripeSignature() would. */
async function call(method, path, { account = ACCOUNT_A, user = ALICE, mode = 'test', body, signature } = {}) {
  const payload = JSON.stringify({ user_id: user, account_id: account });
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': signature ?? stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET }),
      'stripe-user-id': user,
      'stripe-account-id': account,
      'stripe-mode': mode,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON — leave null
  }
  return { status: response.status, json, text };
}

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ok    ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  }
}

async function cleanup() {
  if (!process.env.DATABASE_URL) return;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // notes, account_users, account_settings and user_settings all cascade
    // from stripe_accounts.
    const { rowCount } = await client.query(
      `DELETE FROM "${SCHEMA}"."stripe_accounts" WHERE "id" = ANY($1)`,
      [[ACCOUNT_A, ACCOUNT_B]],
    );
    console.log(`\nCleaned up ${rowCount} test account(s) and everything attached to them.`);
  } finally {
    await client.end();
  }
}

async function main() {
  console.log(`Notes API smoke test against ${BASE} (schema "${SCHEMA}")\n`);

  // --- Signature -----------------------------------------------------------
  console.log('Signature');
  const forged = await call('GET', '/api/stripe-app/notes', { signature: 't=1,v1=deadbeef' });
  check('a forged signature is rejected', forged.status === 401, forged.status);

  const borrowed = await call('GET', '/api/stripe-app/notes', {
    account: ACCOUNT_B,
    signature: stripe.webhooks.generateTestHeaderString({
      payload: JSON.stringify({ user_id: ALICE, account_id: ACCOUNT_A }),
      secret: SECRET,
    }),
  });
  check('a signature for one account does not work for another', borrowed.status === 401, borrowed.status);

  // --- Team ----------------------------------------------------------------
  console.log('\nTeam directory');
  const alice = await call('POST', '/api/stripe-app/team', {
    body: { name: 'Alice Example', email: 'alice@example.com' },
  });
  check('check-in answers with the caller', alice.status === 200 && alice.json?.me === ALICE, alice.text);

  const bob = await call('POST', '/api/stripe-app/team', {
    user: BOB,
    body: { name: 'Bob Example', email: 'bob@example.com' },
  });
  check('a second teammate sees both', bob.json?.members?.length === 2, bob.json);

  const again = await call('POST', '/api/stripe-app/team', { body: {} });
  const aliceRow = again.json?.members?.find((member) => member.id === ALICE);
  check('a check-in without a name keeps the one on file', aliceRow?.name === 'Alice Example', aliceRow);

  await call('POST', '/api/stripe-app/team', {
    account: ACCOUNT_B,
    user: CAROL,
    body: { name: 'Carol Elsewhere', email: 'carol@example.com' },
  });
  const teamA = await call('GET', '/api/stripe-app/team');
  check(
    "another account's people are not in this team",
    teamA.json?.members?.every((member) => member.id !== CAROL),
    teamA.json,
  );

  // --- Creating ------------------------------------------------------------
  console.log('\nCreating notes');
  const plain = await call('POST', '/api/stripe-app/notes', {
    body: { objectType: 'customer', objectId: CUSTOMER, objectLabel: 'Jane Doe', body: '  Called about a refund.  ' },
  });
  check('a plain note is created', plain.status === 201 && plain.json?.note?.isTask === false, plain.text);
  check('its text is trimmed', plain.json?.note?.body === 'Called about a refund.');
  check('a customer note belongs to that customer', plain.json?.note?.customerId === CUSTOMER);
  check('test mode is not paywalled', plain.json?.status?.reason === 'test_mode', plain.json?.status);

  const task = await call('POST', '/api/stripe-app/notes', {
    body: {
      objectType: 'invoice',
      objectId: INVOICE,
      customerId: CUSTOMER,
      objectLabel: 'ABC-0001',
      customerLabel: 'Jane Doe',
      body: 'Invoice was charged twice.\nRefund one of them.',
      isTask: true,
      priority: 'urgent',
      assigneeId: BOB,
    },
  });
  check('a task is created with priority and assignee', task.status === 201 && task.json?.note?.priority === 'urgent' && task.json?.note?.assigneeId === BOB, task.text);
  // The made-up teammates have @example.com addresses, which no provider
  // delivers to: with Postmark configured the outcome is 'failed' (refused
  // recipient), without it 'not_configured'. Either way the backend decided
  // to email — which is what is being checked — and nobody real got one.
  check(
    `assigning to someone else triggers the email (outcome: ${task.json?.notification})`,
    ['sent', 'not_configured', 'failed'].includes(task.json?.notification),
    task.json?.notification,
  );
  const taskId = task.json?.note?.id;

  const lowTask = await call('POST', '/api/stripe-app/notes', {
    body: { objectType: 'payment', objectId: PAYMENT, customerId: CUSTOMER, body: 'Check the receipt email.', isTask: true, priority: 'low', assigneeId: ALICE },
  });
  check('assigning to yourself sends nothing', lowTask.json?.notification === 'none', lowTask.json?.notification);

  const ignored = await call('POST', '/api/stripe-app/notes', {
    body: { objectType: 'customer', objectId: CUSTOMER, body: 'Not a task.', priority: 'urgent', assigneeId: BOB },
  });
  check('priority and assignee are ignored on a plain note', ignored.json?.note?.priority === 'normal' && ignored.json?.note?.assigneeId === null, ignored.json?.note);

  // --- Validation ----------------------------------------------------------
  console.log('\nValidation');
  const empty = await call('POST', '/api/stripe-app/notes', { body: { objectType: 'customer', objectId: CUSTOMER, body: '   ' } });
  check('an empty note is refused', empty.status === 400, empty.text);
  const badId = await call('POST', '/api/stripe-app/notes', { body: { objectType: 'invoice', objectId: CUSTOMER, body: 'x' } });
  check('an id of the wrong kind is refused', badId.status === 400, badId.text);
  const stranger = await call('POST', '/api/stripe-app/notes', {
    body: { objectType: 'customer', objectId: CUSTOMER, body: 'x', isTask: true, assigneeId: 'usr_nobodyknowsme' },
  });
  check('a task cannot be assigned to someone who never opened the app', stranger.status === 400, stranger.text);
  const crossAccount = await call('POST', '/api/stripe-app/notes', {
    body: { objectType: 'customer', objectId: CUSTOMER, body: 'x', isTask: true, assigneeId: CAROL },
  });
  check("a task cannot be assigned to another account's user", crossAccount.status === 400, crossAccount.text);

  // --- Listing -------------------------------------------------------------
  console.log('\nListing');
  const onCustomer = await call('GET', `/api/stripe-app/notes?objectType=customer&objectId=${CUSTOMER}`);
  check("the customer's page shows notes from its invoice and payment too", onCustomer.json?.notes?.length === 4, onCustomer.json?.notes?.length);
  const onInvoice = await call('GET', `/api/stripe-app/notes?objectType=invoice&objectId=${INVOICE}`);
  check('the invoice page shows only its own note', onInvoice.json?.notes?.length === 1, onInvoice.json?.notes?.length);

  const queue = await call('GET', '/api/stripe-app/notes?tasks=true&status=active&sort=priority');
  check('the queue holds only tasks', queue.json?.notes?.length === 2 && queue.json.notes.every((note) => note.isTask), queue.json?.notes);
  check('most urgent first', queue.json?.notes?.[0]?.priority === 'urgent', queue.json?.notes?.map((note) => note.priority));

  const mine = await call('GET', '/api/stripe-app/notes?tasks=true&assignee=me', { user: BOB });
  check('"assigned to me" is per user', mine.json?.notes?.length === 1 && mine.json.notes[0].id === taskId, mine.json?.notes);
  const unassigned = await call('GET', '/api/stripe-app/notes?tasks=true&assignee=unassigned');
  check('nothing is unassigned yet', unassigned.json?.notes?.length === 0, unassigned.json?.notes);

  const paged = await call('GET', `/api/stripe-app/notes?objectType=customer&objectId=${CUSTOMER}&limit=3`);
  check('paging reports more', paged.json?.notes?.length === 3 && paged.json?.hasMore === true, paged.json);
  const lastPage = await call('GET', `/api/stripe-app/notes?objectType=customer&objectId=${CUSTOMER}&limit=3&offset=3`);
  check('the last page reports no more', lastPage.json?.notes?.length === 1 && lastPage.json?.hasMore === false, lastPage.json);

  const summary = await call('GET', '/api/stripe-app/notes/summary', { user: BOB });
  check(
    'the summary counts match',
    summary.json?.open === 2 && summary.json?.assignedToMe === 1 && summary.json?.urgent === 1 && summary.json?.unassigned === 0,
    summary.json,
  );

  // --- Changing ------------------------------------------------------------
  console.log('\nChanging');
  const resolved = await call('PATCH', `/api/stripe-app/notes/${taskId}`, { user: BOB, body: { status: 'resolved' } });
  check('resolving sets resolvedAt', resolved.status === 200 && Boolean(resolved.json?.note?.resolvedAt), resolved.text);
  check('who changed it is recorded', resolved.json?.note?.updatedBy === BOB);
  const reopened = await call('PATCH', `/api/stripe-app/notes/${taskId}`, { body: { status: 'open', body: 'Edited by Alice.' } });
  check('reopening clears resolvedAt, and anyone may edit the text', reopened.json?.note?.resolvedAt === null && reopened.json?.note?.body === 'Edited by Alice.', reopened.json?.note);

  await call('PATCH', '/api/stripe-app/settings', { user: BOB, body: { scope: 'user', settings: { emailOnAssignment: false } } });
  await call('PATCH', `/api/stripe-app/notes/${taskId}`, { body: { assigneeId: null } });
  const optedOut = await call('PATCH', `/api/stripe-app/notes/${taskId}`, { body: { assigneeId: BOB } });
  check('someone who switched the emails off gets none', optedOut.json?.notification === 'opted_out', optedOut.json?.notification);

  const demoted = await call('PATCH', `/api/stripe-app/notes/${taskId}`, { body: { isTask: false } });
  check(
    'turning a task back into a note drops assignee, priority and status',
    demoted.json?.note?.assigneeId === null && demoted.json?.note?.priority === 'normal' && demoted.json?.note?.status === 'open',
    demoted.json?.note,
  );
  const nothing = await call('PATCH', `/api/stripe-app/notes/${taskId}`, { body: {} });
  check('an empty change is refused', nothing.status === 400, nothing.text);

  // --- Isolation -----------------------------------------------------------
  console.log('\nIsolation between accounts and modes');
  const peek = await call('GET', `/api/stripe-app/notes/${taskId}`, { account: ACCOUNT_B, user: CAROL });
  check('another account cannot read a note by id', peek.status === 404, peek.status);
  const tamper = await call('PATCH', `/api/stripe-app/notes/${taskId}`, { account: ACCOUNT_B, user: CAROL, body: { body: 'hijacked' } });
  check('…or change it', tamper.status === 404, tamper.status);
  const destroy = await call('DELETE', `/api/stripe-app/notes/${taskId}`, { account: ACCOUNT_B, user: CAROL });
  check('…or delete it', destroy.status === 404, destroy.status);
  const otherList = await call('GET', `/api/stripe-app/notes?objectType=customer&objectId=${CUSTOMER}`, { account: ACCOUNT_B, user: CAROL });
  check('…or list it', otherList.json?.notes?.length === 0, otherList.json?.notes?.length);
  const stillThere = await call('GET', `/api/stripe-app/notes/${taskId}`);
  check('the note is untouched', stillThere.json?.note?.body === 'Edited by Alice.', stillThere.json?.note?.body);

  const liveList = await call('GET', `/api/stripe-app/notes?objectType=customer&objectId=${CUSTOMER}`, { mode: 'live' });
  check('test-mode notes do not appear in live mode', liveList.json?.notes?.length === 0, liveList.json?.notes?.length);
  const liveRead = await call('GET', `/api/stripe-app/notes/${taskId}`, { mode: 'live' });
  check('…not even by id', liveRead.status === 404, liveRead.status);

  // --- Paywall (live mode) -------------------------------------------------
  console.log('\nPaywall in live mode');
  const noTrial = await call('POST', '/api/stripe-app/notes', {
    mode: 'live',
    body: { objectType: 'customer', objectId: CUSTOMER, body: 'Live note before the trial.' },
  });
  check('creating a note before the trial starts is 402', noTrial.status === 402 && noTrial.json?.status?.reason === 'trial_not_started', noTrial.text);
  const afterRefusal = await call('GET', `/api/stripe-app/notes?objectType=customer&objectId=${CUSTOMER}`, { mode: 'live' });
  check('…and nothing was saved', afterRefusal.json?.notes?.length === 0, afterRefusal.json?.notes?.length);

  const started = await call('POST', '/api/stripe-app/paywall/trial', { mode: 'live' });
  check('the trial starts with the configured limits', started.json?.reason === 'trialing', started.json);
  console.log(`        (limits: ${JSON.stringify(started.json?.limits)})`);

  const liveNote = await call('POST', '/api/stripe-app/notes', {
    mode: 'live',
    body: { objectType: 'customer', objectId: CUSTOMER, body: 'First live note.' },
  });
  check('a note during the trial is created and counted', liveNote.status === 201 && liveNote.json?.status?.trial?.usageCount === 1, liveNote.text);
  const invalidLive = await call('POST', '/api/stripe-app/notes', { mode: 'live', body: { objectType: 'customer', objectId: CUSTOMER, body: '' } });
  const statusAfter = await call('GET', '/api/stripe-app/paywall', { mode: 'live' });
  check('a refused request does not use up the trial', invalidLive.status === 400 && statusAfter.json?.trial?.usageCount === 1, statusAfter.json?.trial);
  const liveEdit = await call('PATCH', `/api/stripe-app/notes/${liveNote.json?.note?.id}`, { mode: 'live', body: { isTask: true, priority: 'high' } });
  const statusAfterEdit = await call('GET', '/api/stripe-app/paywall', { mode: 'live' });
  check('editing a note is not counted', liveEdit.status === 200 && statusAfterEdit.json?.trial?.usageCount === 1, statusAfterEdit.json?.trial);

  // --- Deleting ------------------------------------------------------------
  console.log('\nDeleting');
  const deleted = await call('DELETE', `/api/stripe-app/notes/${taskId}`, { user: BOB });
  check('anyone in the account may delete a note', deleted.status === 200 && deleted.json?.deleted === true, deleted.text);
  const gone = await call('DELETE', `/api/stripe-app/notes/${taskId}`);
  check('deleting it again is 404', gone.status === 404, gone.status);
  const notAnId = await call('GET', '/api/stripe-app/notes/not-a-uuid');
  check('a malformed id is 404, not a server error', notAnId.status === 404, notAnId.status);
}

try {
  await main();
} catch (error) {
  failures.push('the script itself');
  console.error('\nThe smoke test stopped early:', error instanceof Error ? error.message : error);
  if (error instanceof Error && /fetch failed|ECONNREFUSED/.test(`${error.message} ${error.cause ?? ''}`)) {
    console.error(`Is the backend running at ${BASE}? Start it with: npm run dev`);
  }
} finally {
  await cleanup().catch((error) => console.error('Cleanup failed:', error.message));
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
