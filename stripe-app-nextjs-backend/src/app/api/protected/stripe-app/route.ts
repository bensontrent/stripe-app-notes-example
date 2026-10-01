import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';

interface RegisterInstallationBody {
  stripeAccountId: string;
  installationId: string;
  livemode: boolean;
}

// App settings (account-wide and per-user) are not part of an installation:
// they have their own tables and the /api/stripe-app/settings route — see
// src/lib/settings.ts.

// List the Stripe accounts the current user belongs to, with the user's role
// and each account's install state (live and test tracked separately —
// a NULL installation id means "not installed in that mode").
export async function GET(req: NextRequest) {
  try {
    // Verify the session
    const session = await auth.api.getSession({
      headers: req.headers,
    });

    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const supabase = getSupabase();

    // The stripe_accounts(...) part follows the foreign key from memberships
    // to stripe_accounts, like a join. Without generated database types
    // supabase-js can't tell the embed is single-row, so spell the shape out.
    const { data: memberships, error } = await supabase
      .from('memberships')
      .select('stripe_account_id, role, stripe_accounts ( name, live_installation_id, test_installation_id )')
      .eq('user_id', session.user.id)
      .returns<Array<{
        stripe_account_id: string;
        role: string;
        stripe_accounts: {
          name: string | null;
          live_installation_id: string | null;
          test_installation_id: string | null;
        } | null;
      }>>();

    if (error) throw error;

    const accounts = memberships.map((membership) => ({
      stripeAccountId: membership.stripe_account_id,
      name: membership.stripe_accounts?.name ?? null,
      role: membership.role,
      liveInstallationId: membership.stripe_accounts?.live_installation_id ?? null,
      testInstallationId: membership.stripe_accounts?.test_installation_id ?? null,
    }));

    return NextResponse.json({ accounts });
  } catch (error) {
    console.error('Error fetching accounts:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Register an installation: upserts the Stripe account (with the
// mode-appropriate installation id) and the current user's membership in it.
export async function POST(req: NextRequest) {
  try {
    // Verify the session
    const session = await auth.api.getSession({
      headers: req.headers,
    });

    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await req.json() as RegisterInstallationBody;
    const { stripeAccountId, installationId, livemode } = body;

    if (!stripeAccountId || !installationId || typeof livemode !== 'boolean') {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const supabase = getSupabase();

    // Upsert the account row. Only the columns in the payload are written, so
    // an existing row keeps its name and other-mode installation id.
    const installationColumn = livemode
      ? 'live_installation_id'
      : 'test_installation_id';

    const { data: account, error: accountError } = await supabase
      .from('stripe_accounts')
      .upsert(
        {
          id: stripeAccountId,
          [installationColumn]: installationId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      )
      .select()
      .single();
    if (accountError) throw accountError;

    // The first person to register an account becomes its owner; everyone
    // after that joins as a member. Note the role is self-assigned by whoever
    // installs the app — verify it out-of-band before gating anything
    // sensitive on it.
    const { count, error: countError } = await supabase
      .from('memberships')
      .select('*', { count: 'exact', head: true })
      .eq('stripe_account_id', stripeAccountId);
    if (countError) throw countError;

    // ignoreDuplicates makes this "insert if missing, leave alone if present"
    // (the SQL equivalent of ON CONFLICT DO NOTHING) — an existing membership
    // keeps its role.
    const { error: memberError } = await supabase
      .from('memberships')
      .upsert(
        {
          stripe_account_id: stripeAccountId,
          user_id: session.user.id,
          role: count === 0 ? 'owner' : 'member',
        },
        { onConflict: 'stripe_account_id,user_id', ignoreDuplicates: true }
      );
    if (memberError) throw memberError;

    return NextResponse.json({ account });
  } catch (error) {
    console.error('Error registering installation:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
