import Decimal from 'decimal.js';
import { z } from 'zod';
import { getClientAuthHeaders } from '@/lib/supabase/client';
import { toDecimal, toNumericString } from '@/lib/utilities/money';
import { localDb } from '@/offline/indexeddb/db';
import { createLocalTransaction } from '@/modules/transactions/service';
import type { DebtPayment, Liability } from '@/types/financial';

export class LiabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiabilityError';
  }
}

export const createLiabilitySchema = z.object({
  householdId: z.string().uuid(),
  accountId: z.string().uuid().nullable().optional(),
  creditorName: z.string().trim().min(1, 'กรุณาระบุชื่อเจ้าหนี้/สถาบัน'),
  debtName: z.string().trim().min(1, 'กรุณาระบุชื่อรายการหนี้'),
  debtType: z.enum([
    'credit_card',
    'personal_loan',
    'vehicle_loan',
    'mortgage',
    'other',
  ]),
  originalPrincipal: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,4})?$/, 'ยอดเงินต้นต้องเป็นตัวเลขไม่ติดลบ'),
  outstandingBalance: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,4})?$/, 'ยอดหนี้คงเหลือต้องเป็นตัวเลขไม่ติดลบ'),
  interestRate: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,4})?$/, 'อัตราดอกเบี้ยต้องเป็นตัวเลขไม่ติดลบ')
    .default('0'),
  interestType: z.enum(['fixed', 'reducing', 'zero']).default('reducing'),
  minimumPayment: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,4})?$/)
    .default('0'),
  scheduledPayment: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,4})?$/)
    .default('0'),
  paymentFrequency: z
    .enum(['weekly', 'monthly', 'quarterly', 'annual'])
    .default('monthly'),
  nextDueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  currencyCode: z.string().length(3).default('THB'),
});

export type CreateLiabilityInput = z.infer<typeof createLiabilitySchema>;

export async function createLiability(
  rawInput: CreateLiabilityInput
): Promise<Liability> {
  const input = createLiabilitySchema.parse(rawInput);
  const now = new Date().toISOString();
  const outstanding = toDecimal(input.outstandingBalance);

  const liability: Liability = {
    id: crypto.randomUUID(),
    household_id: input.householdId,
    account_id: input.accountId ?? null,
    creditor_name: input.creditorName,
    debt_name: input.debtName,
    debt_type: input.debtType,
    original_principal: toNumericString(input.originalPrincipal, 4),
    outstanding_balance: toNumericString(outstanding, 4),
    interest_rate: toNumericString(input.interestRate, 4),
    interest_type: input.interestType,
    minimum_payment: toNumericString(input.minimumPayment, 4),
    scheduled_payment: toNumericString(input.scheduledPayment, 4),
    payment_frequency: input.paymentFrequency,
    next_due_date: input.nextDueDate ?? null,
    currency_code: input.currencyCode.toUpperCase(),
    status: outstanding.eq(0) ? 'paid_off' : 'active',
    created_at: now,
    updated_at: now,
  };

  await localDb.liabilities.add(liability);

  if (typeof window !== 'undefined' && navigator.onLine) {
    void getClientAuthHeaders().then((authHeaders) =>
      fetch('/api/sync/entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ kind: 'liability', data: liability }),
      })
    ).catch(() => {});
  }

  return liability;
}

export async function listLiabilities(householdId: string): Promise<Liability[]> {
  const items = await localDb.liabilities
    .where('household_id')
    .equals(householdId)
    .toArray();

  return items.sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === 'active' ? -1 : 1;
    }
    return (a.next_due_date ?? '9999-12-31').localeCompare(
      b.next_due_date ?? '9999-12-31'
    );
  });
}

export interface RecordDebtPaymentInput {
  liabilityId: string;
  paymentDate: string;
  principalPaid: string;
  interestPaid: string;
  paymentAccountId?: string | null;
  interestCategoryId?: string | null;
  createdBy: string;
}

/**
 * Records a debt repayment and reconciles outstanding_balance.
 * - Principal reduction does NOT count as an expense (it reduces Asset & Liability).
 * - Interest paid IS recorded as an expense when paymentAccountId & interestCategoryId are provided.
 */
export async function recordDebtPayment(
  input: RecordDebtPaymentInput
): Promise<{ liability: Liability; payment: DebtPayment }> {
  const liability = await localDb.liabilities.get(input.liabilityId);
  if (!liability) {
    throw new LiabilityError('ไม่พบรายการหนี้สิน');
  }
  if (liability.status !== 'active') {
    throw new LiabilityError('หนี้สินรายการนี้ปิดยอดไปแล้ว');
  }

  const principal = toDecimal(input.principalPaid || '0');
  const interest = toDecimal(input.interestPaid || '0');
  const total = principal.plus(interest);

  if (principal.lt(0) || interest.lt(0) || total.lte(0)) {
    throw new LiabilityError('ยอดชำระต้องมากกว่า 0 และไม่ติดลบ');
  }

  const currentOutstanding = toDecimal(liability.outstanding_balance);
  if (principal.gt(currentOutstanding)) {
    throw new LiabilityError(
      `ยอดตัดเงินต้น (${principal.toFixed(2)}) มากกว่าหนี้คงเหลือ (${currentOutstanding.toFixed(2)})`
    );
  }

  let linkedTxId: string | null = null;

  // Post principal transfer if linked to a financial account
  if (
    principal.gt(0) &&
    input.paymentAccountId &&
    liability.account_id &&
    input.paymentAccountId !== liability.account_id
  ) {
    const res = await createLocalTransaction(
      {
        householdId: liability.household_id,
        transactionType: 'transfer',
        amount: principal.toFixed(4),
        currencyCode: liability.currency_code,
        transactionDate: input.paymentDate,
        accountId: input.paymentAccountId,
        toAccountId: liability.account_id,
        description: `ชำระเงินต้น: ${liability.debt_name}`,
        idempotencyKey: crypto.randomUUID(),
        asDraft: false,
      },
      input.createdBy
    );
    linkedTxId = res.transaction.id;
  }

  // Post interest expense if applicable
  if (interest.gt(0) && input.paymentAccountId && input.interestCategoryId) {
    const res = await createLocalTransaction(
      {
        householdId: liability.household_id,
        transactionType: 'expense',
        amount: interest.toFixed(4),
        currencyCode: liability.currency_code,
        transactionDate: input.paymentDate,
        accountId: input.paymentAccountId,
        categoryId: input.interestCategoryId,
        description: `ดอกเบี้ย: ${liability.debt_name}`,
        idempotencyKey: crypto.randomUUID(),
        asDraft: false,
      },
      input.createdBy
    );
    if (!linkedTxId) {
      linkedTxId = res.transaction.id;
    }
  }

  const nextOutstanding: Decimal = currentOutstanding.minus(principal);
  const now = new Date().toISOString();

  const updatedLiability: Liability = {
    ...liability,
    outstanding_balance: nextOutstanding.toFixed(4),
    status: nextOutstanding.eq(0) ? 'paid_off' : 'active',
    updated_at: now,
  };

  const payment: DebtPayment = {
    id: crypto.randomUUID(),
    liability_id: liability.id,
    transaction_id: linkedTxId,
    payment_date: input.paymentDate,
    principal_paid: principal.toFixed(4),
    interest_paid: interest.toFixed(4),
    total_paid: total.toFixed(4),
    created_at: now,
  };

  await localDb.transaction(
    'rw',
    [localDb.liabilities, localDb.debt_payments],
    async () => {
      await localDb.liabilities.put(updatedLiability);
      await localDb.debt_payments.add(payment);
    }
  );

  if (typeof window !== 'undefined' && navigator.onLine) {
    void getClientAuthHeaders().then(async (authHeaders) => {
      await fetch('/api/sync/entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ kind: 'liability', data: updatedLiability }),
      });
      await fetch('/api/sync/entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ kind: 'debt_payment', data: payment }),
      });
    }).catch(() => {});
  }

  return { liability: updatedLiability, payment };
}

export async function getUpcomingDebtPayments(
  householdId: string
): Promise<Liability[]> {
  const all = await listLiabilities(householdId);
  return all.filter((l) => l.status === 'active' && l.next_due_date !== null);
}
