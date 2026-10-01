// scripts/seed-plans.mjs — creates the example's plans in Stripe.
//
//   npm run billing:seed             create a Product + Price in your TEST
//                                    billing account for every plan in
//                                    src/config/plans.json that doesn't have
//                                    one yet
//   npm run billing:seed -- --live   the same in LIVE mode (real prices that
//                                    real customers can buy — asks nothing,
//                                    so be sure)
//
// Each price is tagged with the plan's lookup key, which is how the backend
// finds it (src/lib/plans.ts) — no price ids to copy anywhere. Safe to
// re-run: a plan whose lookup key already exists in Stripe is left alone,
// so editing an amount in plans.json does NOT change an existing price.
// To change what a plan costs, create the new price in the Stripe Dashboard
// and move the lookup key to it ("transfer lookup key").
//
// Which key is used (first match wins):
//   STRIPE_BILLING_SECRET_KEY_TEST   a separate billing account, if you have one
//   STRIPE_SECRET_KEY_TEST           otherwise the app account
// (…_LIVE with --live.) Same fallback as getStripeClient(env, 'billing') in
// src/lib/stripe.ts.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';
import { isConfigured, loadEnv } from './env.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const live = process.argv.includes('--live');
const suffix = live ? 'LIVE' : 'TEST';
const expectedPrefix = live ? /^(sk|rk)_live_/ : /^(sk|rk)_test_/;

loadEnv(root);

const keyName = [`STRIPE_BILLING_SECRET_KEY_${suffix}`, `STRIPE_SECRET_KEY_${suffix}`].find(
  (name) => isConfigured(process.env[name]),
);
if (!keyName) {
  console.error(
    `No Stripe ${live ? 'live' : 'test'} key found — set STRIPE_SECRET_KEY_${suffix} in .env.local (npm run setup does this for the test key).`,
  );
  process.exit(1);
}
const secretKey = process.env[keyName].trim();
if (!expectedPrefix.test(secretKey)) {
  console.error(
    `${keyName} is not a ${live ? 'live' : 'test'}-mode key. Refusing to continue so plans never land in the wrong mode.`,
  );
  process.exit(1);
}

const plans = JSON.parse(readFileSync(join(root, 'src', 'config', 'plans.json'), 'utf8'));
const stripe = new Stripe(secretKey);

try {
  const existing = await stripe.prices.list({
    lookup_keys: plans.map((plan) => plan.lookupKey),
    limit: 100,
  });
  const existingKeys = new Set(existing.data.map((price) => price.lookup_key));

  console.log(`Seeding plans in ${live ? 'LIVE' : 'test'} mode (key from ${keyName}):\n`);

  for (const plan of plans) {
    if (existingKeys.has(plan.lookupKey)) {
      console.log(`  = ${plan.name.padEnd(14)} ${plan.lookupKey} (already exists)`);
      continue;
    }

    // product_data creates the Product in the same call.
    const price = await stripe.prices.create({
      lookup_key: plan.lookupKey,
      unit_amount: plan.unitAmount,
      currency: plan.currency,
      recurring: { interval: plan.interval },
      product_data: {
        name: plan.name,
        metadata: { lookup_key: plan.lookupKey, description: plan.description },
      },
    });
    console.log(`  + ${plan.name.padEnd(14)} ${plan.lookupKey} → ${price.id}`);
  }

  console.log(
    '\nDone. The plans are now buyable on /billing.\n' +
      'One manual step before "Manage plan" works: save the customer portal settings once\n' +
      `(${live ? 'https://dashboard.stripe.com/settings/billing/portal' : 'https://dashboard.stripe.com/test/settings/billing/portal'}).`,
  );
} catch (error) {
  console.error(`Seeding failed: ${error.message}`);
  process.exitCode = 1;
}
