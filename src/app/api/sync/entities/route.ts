import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedSupabase } from '@/lib/supabase/server';

const accountUpsertSchema = z.object({
  kind: z.literal('account'),
  data: z.object({
    id: z.string().uuid(),
    household_id: z.string().uuid(),
    name: z.string().min(1),
    account_type: z.enum(['cash', 'bank', 'wallet', 'investment', 'credit_card', 'loan']),
    institution: z.string().nullable().optional(),
    account_number: z.string().nullable().optional(),
    icon: z.string().nullable().optional(),
    currency_code: z.string().length(3).default('THB'),
    opening_balance: z.string(),
    is_active: z.boolean().default(true),
  }),
});

const categoryUpsertSchema = z.object({
  kind: z.literal('category'),
  data: z.object({
    id: z.string().uuid(),
    household_id: z.string().uuid(),
    name: z.string().min(1),
    category_type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER', 'INVESTMENT']),
    icon: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
    sort_order: z.number().int().default(0),
    is_active: z.boolean().default(true),
  }),
});

const budgetUpsertSchema = z.object({
  kind: z.literal('budget'),
  data: z.object({
    id: z.string().uuid(),
    household_id: z.string().uuid(),
    category_id: z.string().uuid().nullable(),
    period_type: z.enum(['weekly', 'monthly', 'annual']),
    period_start: z.string(),
    period_end: z.string(),
    budget_amount: z.string(),
    currency_code: z.string().length(3).default('THB'),
  }),
});

const budgetDeleteSchema = z.object({
  kind: z.literal('budget_delete'),
  id: z.string().uuid(),
});

const liabilityUpsertSchema = z.object({
  kind: z.literal('liability'),
  data: z.object({
    id: z.string().uuid(),
    household_id: z.string().uuid(),
    account_id: z.string().uuid().nullable().optional(),
    creditor_name: z.string(),
    debt_name: z.string(),
    debt_type: z.enum(['credit_card', 'personal_loan', 'vehicle_loan', 'mortgage', 'other']),
    original_principal: z.string(),
    outstanding_balance: z.string(),
    interest_rate: z.string(),
    interest_type: z.enum(['fixed', 'reducing', 'zero']),
    minimum_payment: z.string(),
    scheduled_payment: z.string(),
    payment_frequency: z.enum(['weekly', 'monthly', 'quarterly', 'annual']),
    next_due_date: z.string().nullable().optional(),
    currency_code: z.string().length(3).default('THB'),
    status: z.enum(['active', 'paid_off', 'closed']),
  }),
});

const debtPaymentInsertSchema = z.object({
  kind: z.literal('debt_payment'),
  data: z.object({
    id: z.string().uuid(),
    liability_id: z.string().uuid(),
    transaction_id: z.string().uuid().nullable().optional(),
    payment_date: z.string(),
    principal_paid: z.string(),
    interest_paid: z.string(),
    total_paid: z.string(),
  }),
});

const calendarEventUpsertSchema = z.object({
  kind: z.literal('calendar_event'),
  data: z.object({
    id: z.string().uuid(),
    household_id: z.string().uuid(),
    event_type: z.enum(['INCOME', 'EXPENSE', 'DEBT_PAYMENT', 'INVESTMENT', 'BILL', 'REMINDER', 'CUSTOM']),
    title: z.string(),
    description: z.string().default(''),
    event_date: z.string(),
    amount: z.string().nullable().optional(),
    currency_code: z.string().length(3).default('THB'),
    related_liability_id: z.string().uuid().nullable().optional(),
    source_type: z.enum(['manual', 'recurring', 'liability', 'transaction']).default('manual'),
    status: z.enum(['scheduled', 'completed', 'cancelled', 'overdue']).default('scheduled'),
  }),
});

const entitySyncSchema = z.discriminatedUnion('kind', [
  accountUpsertSchema,
  categoryUpsertSchema,
  budgetUpsertSchema,
  budgetDeleteSchema,
  liabilityUpsertSchema,
  debtPaymentInsertSchema,
  calendarEventUpsertSchema,
]);

const CLASS_AND_CODE_BY_TYPE: Record<
  string,
  { codePrefix: string; accountClass: 'ASSET' | 'LIABILITY' }
> = {
  cash: { codePrefix: '1100', accountClass: 'ASSET' },
  bank: { codePrefix: '1200', accountClass: 'ASSET' },
  wallet: { codePrefix: '1300', accountClass: 'ASSET' },
  investment: { codePrefix: '1400', accountClass: 'ASSET' },
  credit_card: { codePrefix: '2100', accountClass: 'LIABILITY' },
  loan: { codePrefix: '2200', accountClass: 'LIABILITY' },
};

export async function POST(request: Request) {
  try {
    const { supabase, user, error: authError } =
      await getAuthenticatedSupabase(request);

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = entitySyncSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid entity payload', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const item = parsed.data;

    if (item.kind === 'account') {
      const a = item.data;
      const { data: existingAcc } = await supabase
        .from('accounts')
        .select('id, ledger_account_id')
        .eq('id', a.id)
        .maybeSingle();

      let ledgerAccountId = existingAcc?.ledger_account_id as string | undefined;

      if (!ledgerAccountId) {
        const meta = CLASS_AND_CODE_BY_TYPE[a.account_type] ?? {
          codePrefix: '1200',
          accountClass: 'ASSET',
        };
        const uniqueCode = `${meta.codePrefix}-${a.id.slice(0, 6)}`;
        const { data: createdLedger, error: ledgerErr } = await supabase
          .from('ledger_accounts')
          .insert({
            household_id: a.household_id,
            code: uniqueCode,
            name: a.name,
            account_class: meta.accountClass,
            is_system: false,
            is_active: true,
          })
          .select('id')
          .single();

        if (ledgerErr || !createdLedger) {
          return NextResponse.json(
            { error: ledgerErr?.message ?? 'Failed to create ledger account' },
            { status: 400 }
          );
        }
        ledgerAccountId = createdLedger.id as string;
      }

      const { error } = await supabase.from('accounts').upsert({
        id: a.id,
        household_id: a.household_id,
        ledger_account_id: ledgerAccountId,
        name: a.name,
        account_type: a.account_type,
        institution: a.institution ?? null,
        account_number: a.account_number ?? null,
        icon: a.icon ?? null,
        currency_code: a.currency_code,
        opening_balance: a.opening_balance,
        owner_user_id: user.id,
        is_active: a.is_active,
        updated_at: new Date().toISOString(),
      });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true, ledger_account_id: ledgerAccountId });
    }

    if (item.kind === 'category') {
      const c = item.data;
      const catCode =
        c.category_type === 'INCOME'
          ? '4100'
          : c.category_type === 'INVESTMENT'
            ? '1400'
            : '5900';

      const { data: ledger } = await supabase
        .from('ledger_accounts')
        .select('id')
        .eq('household_id', c.household_id)
        .eq('code', catCode)
        .limit(1)
        .single();

      const { error } = await supabase.from('categories').upsert({
        id: c.id,
        household_id: c.household_id,
        ledger_account_id: ledger?.id ?? null,
        name: c.name,
        category_type: c.category_type,
        icon: c.icon ?? null,
        color: c.color ?? null,
        sort_order: c.sort_order,
        is_active: c.is_active,
      });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    if (item.kind === 'budget') {
      const b = item.data;
      const { error } = await supabase.from('budgets').upsert({
        ...b,
        updated_at: new Date().toISOString(),
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    if (item.kind === 'budget_delete') {
      const { error } = await supabase.from('budgets').delete().eq('id', item.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    if (item.kind === 'liability') {
      const l = item.data;
      const { error } = await supabase.from('liabilities').upsert({
        ...l,
        owner_user_id: user.id,
        updated_at: new Date().toISOString(),
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    if (item.kind === 'debt_payment') {
      const p = item.data;
      const { error } = await supabase.from('debt_payments').upsert(p);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    if (item.kind === 'calendar_event') {
      const ev = item.data;
      const { error } = await supabase.from('calendar_events').upsert({
        ...ev,
        owner_user_id: user.id,
        updated_at: new Date().toISOString(),
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown kind' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Entity sync failed' },
      { status: 500 }
    );
  }
}
