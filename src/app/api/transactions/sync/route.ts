import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createTransactionSchema } from '@/lib/validation/transaction';

const reverseOperationSchema = z.object({
  originalTransactionId: z.string().uuid(),
  reversalTransactionId: z.string().uuid(),
  reversalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  idempotencyKey: z.string().uuid(),
  reason: z.string().max(500).optional().default('User reversal'),
});

const syncItemSchema = z.discriminatedUnion('operation', [
  z.object({
    outboxId: z.string().uuid(),
    operation: z.literal('create'),
    payload: createTransactionSchema.extend({
      id: z.string().uuid(),
    }),
  }),
  z.object({
    outboxId: z.string().uuid(),
    operation: z.literal('reverse'),
    payload: reverseOperationSchema,
  }),
]);

const syncBatchSchema = z.object({
  items: z.array(syncItemSchema).min(1).max(50),
});

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized: authentication required for sync' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const parsed = syncBatchSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid sync payload', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const results: Array<{
      outboxId: string;
      status: 'synced' | 'conflict' | 'failed';
      serverResult?: unknown;
      error?: string;
    }> = [];

    for (const item of parsed.data.items) {
      if (item.operation === 'create') {
        const p = item.payload;
        const { data, error } = await supabase.rpc('post_finora_transaction', {
          p_id: p.id,
          p_household_id: p.householdId,
          p_account_id: p.accountId,
          p_to_account_id: p.toAccountId ?? null,
          p_category_id: p.categoryId ?? null,
          p_transaction_type: p.transactionType,
          p_amount: p.amount,
          p_currency_code: p.currencyCode,
          p_transaction_date: p.transactionDate,
          p_description: p.description,
          p_idempotency_key: p.idempotencyKey,
          p_notes: p.notes ?? null,
          p_tags: p.tags ?? [],
        });

        if (error) {
          const isConflict =
            error.message.includes('Access denied') ||
            error.message.includes('not found');
          results.push({
            outboxId: item.outboxId,
            status: isConflict ? 'conflict' : 'failed',
            error: error.message,
          });
        } else {
          results.push({
            outboxId: item.outboxId,
            status: 'synced',
            serverResult: data,
          });
        }
      } else if (item.operation === 'reverse') {
        const p = item.payload;
        const { data, error } = await supabase.rpc('reverse_finora_transaction', {
          p_original_transaction_id: p.originalTransactionId,
          p_reversal_transaction_id: p.reversalTransactionId,
          p_reversal_date: p.reversalDate,
          p_idempotency_key: p.idempotencyKey,
          p_reason: p.reason,
        });

        if (error) {
          const isConflict =
            error.message.includes('Only posted transactions') ||
            error.message.includes('not found');
          results.push({
            outboxId: item.outboxId,
            status: isConflict ? 'conflict' : 'failed',
            error: error.message,
          });
        } else {
          results.push({
            outboxId: item.outboxId,
            status: 'synced',
            serverResult: data,
          });
        }
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
