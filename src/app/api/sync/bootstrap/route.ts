import { NextResponse } from 'next/server';
import { getAuthenticatedSupabase } from '@/lib/supabase/server';

export async function GET(request: Request) {
  try {
    const { supabase, user, error: authError } =
      await getAuthenticatedSupabase(request);

    if (authError || !user) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    // 1. Find user's household
    const { data: memberships, error: memberErr } = await supabase
      .from('household_members')
      .select('household_id, role')
      .eq('user_id', user.id)
      .limit(1);

    if (memberErr) {
      return NextResponse.json({ error: memberErr.message }, { status: 500 });
    }

    let householdId: string | null = memberships?.[0]?.household_id ?? null;

    // Auto-provision personal household if user has none yet
    if (!householdId) {
      const { data: provisionedId, error: provErr } = await supabase.rpc(
        'provision_personal_household',
        {
          p_user_id: user.id,
          p_display_name:
            (user.user_metadata?.display_name as string | undefined) ||
            user.email?.split('@')[0] ||
            'FINORA User',
        }
      );
      if (provErr) {
        return NextResponse.json({ error: provErr.message }, { status: 500 });
      }
      householdId = provisionedId as string;
    }

    // 2. Pull household data in parallel
    const [
      ledgerRes,
      accountsRes,
      categoriesRes,
      transactionsRes,
      journalEntriesRes,
      budgetsRes,
      liabilitiesRes,
      calendarEventsRes,
    ] = await Promise.all([
      supabase
        .from('ledger_accounts')
        .select('id, account_class, code, name')
        .eq('household_id', householdId),
      supabase
        .from('accounts')
        .select('*')
        .eq('household_id', householdId)
        .order('created_at', { ascending: true }),
      supabase
        .from('categories')
        .select('*')
        .eq('household_id', householdId)
        .order('sort_order', { ascending: true }),
      supabase
        .from('transactions')
        .select('*')
        .eq('household_id', householdId)
        .order('transaction_date', { ascending: false }),
      supabase
        .from('journal_entries')
        .select('*')
        .eq('household_id', householdId),
      supabase
        .from('budgets')
        .select('*')
        .eq('household_id', householdId),
      supabase
        .from('liabilities')
        .select('*')
        .eq('household_id', householdId),
      supabase
        .from('calendar_events')
        .select('*')
        .eq('household_id', householdId),
    ]);

    const ledgerMap = new Map<string, string>();
    for (const la of ledgerRes.data ?? []) {
      ledgerMap.set(la.id as string, la.account_class as string);
    }

    const accounts = (accountsRes.data ?? []).map((acc) => ({
      ...acc,
      account_class: ledgerMap.get(acc.ledger_account_id as string) ?? 'ASSET',
      opening_balance: String(acc.opening_balance ?? '0'),
    }));

    const entryIds = (journalEntriesRes.data ?? []).map((e) => e.id as string);
    let journalLines: Array<Record<string, unknown>> = [];
    if (entryIds.length > 0) {
      const { data: linesData } = await supabase
        .from('journal_lines')
        .select('*')
        .in('journal_entry_id', entryIds);
      journalLines = (linesData ?? []).map((l) => ({
        ...l,
        debit: String(l.debit ?? '0'),
        credit: String(l.credit ?? '0'),
      }));
    }

    const transactions = (transactionsRes.data ?? []).map((t) => ({
      ...t,
      amount: String(t.amount),
      sync_status: 'synced',
    }));

    return NextResponse.json({
      authenticated: true,
      userId: user.id,
      email: user.email,
      householdId,
      ledgerAccounts: ledgerRes.data ?? [],
      accounts,
      categories: categoriesRes.data ?? [],
      transactions,
      journalEntries: journalEntriesRes.data ?? [],
      journalLines,
      budgets: (budgetsRes.data ?? []).map((b) => ({
        ...b,
        budget_amount: String(b.budget_amount),
      })),
      liabilities: (liabilitiesRes.data ?? []).map((l) => ({
        ...l,
        original_principal: String(l.original_principal),
        outstanding_balance: String(l.outstanding_balance),
        interest_rate: String(l.interest_rate),
        minimum_payment: String(l.minimum_payment),
        scheduled_payment: String(l.scheduled_payment),
      })),
      calendarEvents: (calendarEventsRes.data ?? []).map((ev) => ({
        ...ev,
        amount: ev.amount !== null && ev.amount !== undefined ? String(ev.amount) : null,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Bootstrap failed' },
      { status: 500 }
    );
  }
}
