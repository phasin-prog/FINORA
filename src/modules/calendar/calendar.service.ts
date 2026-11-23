import Decimal from 'decimal.js';
import { z } from 'zod';
import { toDecimal, toNumericString } from '@/lib/utilities/money';
import { localDb } from '@/offline/indexeddb/db';
import {
  listCalendarEventsByHousehold,
  saveCalendarEvent,
} from '@/modules/calendar/calendar.repository';
import type {
  CalendarDisplayItem,
  CalendarEventRecord,
  MonthlyFinancialSummary,
} from '@/modules/calendar/calendar.types';
import { toBangkokDateString } from '@/modules/calendar/calendar.utils';

export const createCalendarEventSchema = z.object({
  householdId: z.string().uuid(),
  ownerUserId: z.string().uuid().nullable().optional(),
  eventType: z.enum([
    'INCOME',
    'EXPENSE',
    'DEBT_PAYMENT',
    'INVESTMENT',
    'BILL',
    'REMINDER',
    'CUSTOM',
  ]),
  title: z.string().trim().min(1, 'กรุณาระบุชื่อเหตุการณ์'),
  description: z.string().max(500).default(''),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,4})?$/)
    .nullable()
    .optional(),
  currencyCode: z.string().length(3).default('THB'),
  relatedLiabilityId: z.string().uuid().nullable().optional(),
});

export type CreateCalendarEventInput = z.infer<typeof createCalendarEventSchema>;

export async function createCalendarEvent(
  rawInput: CreateCalendarEventInput
): Promise<CalendarEventRecord> {
  const input = createCalendarEventSchema.parse(rawInput);
  const now = new Date().toISOString();

  const record: CalendarEventRecord = {
    id: crypto.randomUUID(),
    household_id: input.householdId,
    owner_user_id: input.ownerUserId ?? null,
    event_type: input.eventType,
    title: input.title,
    description: input.description,
    event_date: input.eventDate,
    amount: input.amount ? toNumericString(input.amount, 4) : null,
    currency_code: input.currencyCode.toUpperCase(),
    related_transaction_id: null,
    related_liability_id: input.relatedLiabilityId ?? null,
    source_type: 'manual',
    status: 'scheduled',
    created_at: now,
    updated_at: now,
  };

  return saveCalendarEvent(record);
}

export async function rescheduleCalendarEvent(
  eventId: string,
  newDate: string
): Promise<CalendarEventRecord | null> {
  const existing = await localDb.calendar_events.get(eventId);
  if (!existing) return null;
  const updated: CalendarEventRecord = {
    ...existing,
    event_date: newDate,
    updated_at: new Date().toISOString(),
  };
  return saveCalendarEvent(updated);
}

/**
 * Returns all calendar items for a given YYYY-MM month, combining:
 * 1. Actual posted transactions (is_actual = true)
 * 2. Scheduled/expected calendar_events (is_actual = false)
 * 3. Active liabilities with next_due_date in that month (is_actual = false)
 *
 * Strictly separates Expected vs Actual in MonthlyFinancialSummary (Addendum 2.3).
 */
export async function getMonthlyFinancialCalendar(
  householdId: string,
  monthKey: string, // YYYY-MM
  todayBangkok: string = toBangkokDateString()
): Promise<{
  items: CalendarDisplayItem[];
  summary: MonthlyFinancialSummary;
}> {
  const [manualEvents, transactions, liabilities] = await Promise.all([
    listCalendarEventsByHousehold(householdId),
    localDb.transactions
      .where('household_id')
      .equals(householdId)
      .filter(
        (t) =>
          t.status === 'posted' &&
          t.transaction_date.startsWith(monthKey) &&
          (t.transaction_type === 'income' || t.transaction_type === 'expense')
      )
      .toArray(),
    localDb.liabilities
      .where('household_id')
      .equals(householdId)
      .filter(
        (l) =>
          l.status === 'active' &&
          l.next_due_date !== null &&
          l.next_due_date.startsWith(monthKey)
      )
      .toArray(),
  ]);

  const items: CalendarDisplayItem[] = [];

  let expectedIncome = new Decimal(0);
  let actualIncome = new Decimal(0);
  let expectedExpenses = new Decimal(0);
  let actualExpenses = new Decimal(0);
  let upcomingPayments = new Decimal(0);

  // 1. Actual posted transactions
  for (const tx of transactions) {
    const amt = toDecimal(tx.amount);
    if (tx.transaction_type === 'income') {
      actualIncome = actualIncome.plus(amt);
    } else if (tx.transaction_type === 'expense') {
      actualExpenses = actualExpenses.plus(amt);
    }

    items.push({
      id: `tx-${tx.id}`,
      event_type: tx.transaction_type === 'income' ? 'INCOME' : 'EXPENSE',
      title: tx.description || (tx.transaction_type === 'income' ? 'รายรับ' : 'รายจ่าย'),
      description: 'รายการที่บันทึกจริง',
      event_date: tx.transaction_date,
      amount: tx.amount,
      currency_code: tx.currency_code,
      is_actual: true,
      status: 'completed',
      related_transaction_id: tx.id,
      related_liability_id: null,
    });
  }

  // 2. Manual / Scheduled calendar events
  for (const ev of manualEvents) {
    if (!ev.event_date.startsWith(monthKey) || ev.status === 'cancelled') continue;
    const isOverdue =
      ev.status === 'scheduled' && ev.event_date < todayBangkok;
    const effectiveStatus = isOverdue ? 'overdue' : ev.status;

    if (ev.amount && ev.status !== 'completed') {
      const amt = toDecimal(ev.amount);
      if (ev.event_type === 'INCOME') {
        expectedIncome = expectedIncome.plus(amt);
      } else if (
        ev.event_type === 'EXPENSE' ||
        ev.event_type === 'BILL' ||
        ev.event_type === 'DEBT_PAYMENT'
      ) {
        expectedExpenses = expectedExpenses.plus(amt);
        if (ev.event_date >= todayBangkok || effectiveStatus === 'overdue') {
          upcomingPayments = upcomingPayments.plus(amt);
        }
      }
    }

    items.push({
      id: ev.id,
      event_type: ev.event_type,
      title: ev.title,
      description: ev.description,
      event_date: ev.event_date,
      amount: ev.amount,
      currency_code: ev.currency_code,
      is_actual: false,
      status: effectiveStatus,
      related_transaction_id: ev.related_transaction_id,
      related_liability_id: ev.related_liability_id,
    });
  }

  // 3. Active liabilities due in this month
  for (const debt of liabilities) {
    const dueDate = debt.next_due_date!;
    const payAmt = toDecimal(
      toDecimal(debt.scheduled_payment).gt(0)
        ? debt.scheduled_payment
        : debt.minimum_payment
    );
    const isOverdue = dueDate < todayBangkok;

    if (payAmt.gt(0)) {
      expectedExpenses = expectedExpenses.plus(payAmt);
      upcomingPayments = upcomingPayments.plus(payAmt);
    }

    items.push({
      id: `debt-${debt.id}`,
      event_type: 'DEBT_PAYMENT',
      title: `ครบกำหนดชำระ: ${debt.debt_name}`,
      description: debt.creditor_name,
      event_date: dueDate,
      amount: payAmt.gt(0) ? payAmt.toFixed(4) : debt.outstanding_balance,
      currency_code: debt.currency_code,
      is_actual: false,
      status: isOverdue ? 'overdue' : 'scheduled',
      related_transaction_id: null,
      related_liability_id: debt.id,
    });
  }

  items.sort((a, b) => a.event_date.localeCompare(b.event_date));

  return {
    items,
    summary: {
      monthKey,
      expectedIncome: expectedIncome.toFixed(4),
      actualIncome: actualIncome.toFixed(4),
      expectedExpenses: expectedExpenses.toFixed(4),
      actualExpenses: actualExpenses.toFixed(4),
      upcomingPayments: upcomingPayments.toFixed(4),
      netCashFlow: actualIncome.minus(actualExpenses).toFixed(4),
    },
  };
}
