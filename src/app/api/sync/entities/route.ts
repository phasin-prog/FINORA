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

const entitySyncSchema = z.discriminatedUnion('kind', [
  accountUpsertSchema,
  categoryUpsertSchema,
]);

const CODE_BY_ACCOUNT_TYPE: Record<string, string> = {
  cash: '1100',
  bank: '1200',
  wallet: '1300',
  investment: '1400',
  credit_card: '2100',
  loan: '2200',
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

    if (parsed.data.kind === 'account') {
      const a = parsed.data.data;
      const code = CODE_BY_ACCOUNT_TYPE[a.account_type] ?? '1200';
      const { data: ledger } = await supabase
        .from('ledger_accounts')
        .select('id')
        .eq('household_id', a.household_id)
        .eq('code', code)
        .limit(1)
        .single();

      if (!ledger) {
        return NextResponse.json(
          { error: 'Ledger account not found for household' },
          { status: 400 }
        );
      }

      const { error } = await supabase.from('accounts').upsert({
        id: a.id,
        household_id: a.household_id,
        ledger_account_id: ledger.id,
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
      return NextResponse.json({ ok: true, ledger_account_id: ledger.id });
    }

    const c = parsed.data.data;
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
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Entity sync failed' },
      { status: 500 }
    );
  }
}
