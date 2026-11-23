import Decimal from 'decimal.js';
import { z } from 'zod';
import { toDecimal, toNumericString } from '@/lib/utilities/money';
import { localDb } from '@/offline/indexeddb/db';
import type { Budget, BudgetPeriodType } from '@/types/financial';

export const createBudgetSchema = z
  .object({
    householdId: z.string().uuid(),
    categoryId: z.string().uuid().nullable().optional(),
    periodType: z.enum(['weekly', 'monthly', 'annual']),
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    budgetAmount: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,4})?$/, 'จำนวนงบประมาณต้องเป็นตัวเลขไม่ติดลบ'),
    currencyCode: z.string().length(3).default('THB'),
  })
  .refine((d) => d.periodEnd >= d.periodStart, {
    message: 'วันสิ้นสุดต้องไม่น้อยกว่าวันเริ่มต้น',
    path: ['periodEnd'],
  });

export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;

export interface BudgetEvaluation extends Budget {
  spent_amount: string;
  remaining_amount: string;
  percent_used: number;
  health: 'on_track' | 'warning' | 'exceeded';
}

export async function createBudget(rawInput: CreateBudgetInput): Promise<Budget> {
  const input = createBudgetSchema.parse(rawInput);
  const now = new Date().toISOString();

  const budget: Budget = {
    id: crypto.randomUUID(),
    household_id: input.householdId,
    category_id: input.categoryId ?? null,
    period_type: input.periodType as BudgetPeriodType,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    budget_amount: toNumericString(input.budgetAmount, 4),
    currency_code: input.currencyCode.toUpperCase(),
    created_at: now,
    updated_at: now,
  };

  await localDb.budgets.add(budget);
  return budget;
}

export async function deleteBudget(budgetId: string): Promise<void> {
  await localDb.budgets.delete(budgetId);
}

/**
 * Evaluates all budgets for a household using strictly POSTED expense transactions.
 * Draft, pending, cancelled, reversed, and transfer transactions are excluded (Section 4.2.F).
 */
export async function evaluateBudgets(
  householdId: string
): Promise<BudgetEvaluation[]> {
  const [budgets, postedExpenses] = await Promise.all([
    localDb.budgets.where('household_id').equals(householdId).toArray(),
    localDb.transactions
      .where('household_id')
      .equals(householdId)
      .filter(
        (t) =>
          t.status === 'posted' &&
          !t.reversed_transaction_id &&
          t.transaction_type === 'expense'
      )
      .toArray(),
  ]);

  return budgets.map((b) => {
    let spent = new Decimal(0);
    for (const tx of postedExpenses) {
      if (tx.transaction_date < b.period_start || tx.transaction_date > b.period_end) {
        continue;
      }
      if (b.category_id && tx.category_id !== b.category_id) {
        continue;
      }
      spent = spent.plus(toDecimal(tx.amount));
    }

    const limit = toDecimal(b.budget_amount);
    const remaining = limit.minus(spent);
    const percentUsed = limit.gt(0)
      ? Number(spent.div(limit).times(100).toFixed(1))
      : spent.gt(0)
        ? 100
        : 0;

    let health: BudgetEvaluation['health'] = 'on_track';
    if (spent.gt(limit)) {
      health = 'exceeded';
    } else if (percentUsed >= 80) {
      health = 'warning';
    }

    return {
      ...b,
      spent_amount: spent.toFixed(4),
      remaining_amount: remaining.toFixed(4),
      percent_used: percentUsed,
      health,
    };
  });
}
