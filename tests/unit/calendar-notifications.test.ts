import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { localDb } from '@/offline/indexeddb/db';
import {
  createCalendarEvent,
  getMonthlyFinancialCalendar,
} from '@/modules/calendar/calendar.service';
import { createBudget } from '@/modules/budgets/service';
import {
  createLiability,
  recordDebtPayment,
} from '@/modules/liabilities/service';
import {
  evaluateAndGenerateNotifications,
  markNotificationAsRead,
  toggleNotificationPreference,
} from '@/modules/notifications/notification.service';
import { listPreferencesForUser } from '@/modules/notifications/notification.repository';
import { createLocalTransaction } from '@/modules/transactions/service';
import type { Category, FinancialAccount } from '@/types/financial';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const BANK_ID = 'aaaa1111-1111-4111-8111-111111111111';
const SALARY_CAT_ID = 'cccc1111-1111-4111-8111-111111111111';
const FOOD_CAT_ID = 'cccc2222-2222-4222-8222-222222222222';

const bankAccount: FinancialAccount = {
  id: BANK_ID,
  household_id: HOUSEHOLD_ID,
  ledger_account_id: 'la-bank',
  account_class: 'ASSET',
  name: 'Main Bank',
  account_type: 'bank',
  currency_code: 'THB',
  opening_balance: '20000.0000',
  is_private: false,
  is_active: true,
};

const salaryCategory: Category = {
  id: SALARY_CAT_ID,
  household_id: HOUSEHOLD_ID,
  parent_id: null,
  ledger_account_id: 'la-salary',
  name: 'เงินเดือน',
  category_type: 'INCOME',
  sort_order: 1,
  is_system: true,
  is_active: true,
};

const foodCategory: Category = {
  id: FOOD_CAT_ID,
  household_id: HOUSEHOLD_ID,
  parent_id: null,
  ledger_account_id: 'la-food',
  name: 'อาหาร',
  category_type: 'EXPENSE',
  sort_order: 2,
  is_system: true,
  is_active: true,
};

describe('FINORA v1.1 Financial Calendar & Notification Center', () => {
  beforeEach(async () => {
    await localDb.calendar_events.clear();
    await localDb.notifications.clear();
    await localDb.notification_preferences.clear();
    await localDb.budgets.clear();
    await localDb.liabilities.clear();
    await localDb.debt_payments.clear();
    await localDb.transactions.clear();
    await localDb.journal_entries.clear();
    await localDb.journal_lines.clear();
    await localDb.outbox.clear();
    await localDb.accounts.clear();
    await localDb.categories.clear();

    await localDb.accounts.add(bankAccount);
    await localDb.categories.bulkAdd([salaryCategory, foodCategory]);
  });

  it('separates Expected vs Actual Income/Expenses in Monthly Financial Calendar', async () => {
    // Actual income: 25,000
    await createLocalTransaction(
      {
        householdId: HOUSEHOLD_ID,
        transactionType: 'income',
        amount: '25000',
        currencyCode: 'THB',
        transactionDate: '2026-11-25',
        accountId: BANK_ID,
        categoryId: SALARY_CAT_ID,
        description: 'เงินเดือน',
        idempotencyKey: crypto.randomUUID(),
        asDraft: false,
      },
      USER_ID
    );

    // Expected income: 5,000 freelance
    await createCalendarEvent({
      householdId: HOUSEHOLD_ID,
      ownerUserId: USER_ID,
      eventType: 'INCOME',
      title: 'ค่าจ้างฟรีแลนซ์',
      description: 'คาดว่าจะเข้า',
      eventDate: '2026-11-28',
      amount: '5000',
      currencyCode: 'THB',
    });

    // Expected bill: 1,500
    await createCalendarEvent({
      householdId: HOUSEHOLD_ID,
      ownerUserId: USER_ID,
      eventType: 'BILL',
      title: 'ค่าอินเทอร์เน็ต',
      description: '',
      eventDate: '2026-11-27',
      amount: '1500',
      currencyCode: 'THB',
    });

    const { items, summary } = await getMonthlyFinancialCalendar(
      HOUSEHOLD_ID,
      '2026-11',
      '2026-11-23'
    );

    expect(items).toHaveLength(3);
    expect(summary.actualIncome).toBe('25000.0000');
    expect(summary.expectedIncome).toBe('5000.0000');
    expect(summary.actualExpenses).toBe('0.0000');
    expect(summary.expectedExpenses).toBe('1500.0000');
    expect(summary.upcomingPayments).toBe('1500.0000');
    expect(summary.netCashFlow).toBe('25000.0000');
  });

  it('generates deduplicated debt & budget notifications and cancels reminders when debt is paid off', async () => {
    const liability = await createLiability({
      householdId: HOUSEHOLD_ID,
      creditorName: 'KTC',
      debtName: 'บัตรเครดิต KTC',
      debtType: 'credit_card',
      originalPrincipal: '5000',
      outstandingBalance: '5000',
      interestRate: '16',
      interestType: 'reducing',
      minimumPayment: '500',
      scheduledPayment: '5000',
      paymentFrequency: 'monthly',
      nextDueDate: '2026-11-24', // 1 day from 2026-11-23
      currencyCode: 'THB',
    });

    await createBudget({
      householdId: HOUSEHOLD_ID,
      categoryId: FOOD_CAT_ID,
      periodType: 'monthly',
      periodStart: '2026-11-01',
      periodEnd: '2026-11-30',
      budgetAmount: '1000',
      currencyCode: 'THB',
    });

    await createLocalTransaction(
      {
        householdId: HOUSEHOLD_ID,
        transactionType: 'expense',
        amount: '850',
        currencyCode: 'THB',
        transactionDate: '2026-11-15',
        accountId: BANK_ID,
        categoryId: FOOD_CAT_ID,
        description: 'Food',
        idempotencyKey: crypto.randomUUID(),
        asDraft: false,
      },
      USER_ID
    );

    // First evaluation: generates 1 debt_due_1d + 1 budget_80
    const first = await evaluateAndGenerateNotifications(
      HOUSEHOLD_ID,
      USER_ID,
      '2026-11-23'
    );
    expect(first).toHaveLength(2);
    expect(first.map((n) => n.notification_type).sort()).toEqual([
      'budget_80',
      'debt_due_1d',
    ]);

    // Second evaluation on same day: deduplication_key prevents spam!
    const second = await evaluateAndGenerateNotifications(
      HOUSEHOLD_ID,
      USER_ID,
      '2026-11-23'
    );
    expect(second).toHaveLength(2);

    // Mark budget notification as read — stays in history as 'read'
    const budgetNotif = second.find((n) => n.notification_type === 'budget_80')!;
    await markNotificationAsRead(budgetNotif.id);

    // Pay off the debt completely -> pending debt reminder must be cancelled
    await recordDebtPayment({
      liabilityId: liability.id,
      paymentDate: '2026-11-23',
      principalPaid: '5000',
      interestPaid: '0',
      createdBy: USER_ID,
    });

    const afterPay = await evaluateAndGenerateNotifications(
      HOUSEHOLD_ID,
      USER_ID,
      '2026-11-23'
    );
    expect(afterPay).toHaveLength(1);
    expect(afterPay[0].notification_type).toBe('budget_80');
    expect(afterPay[0].status).toBe('read');
  });

  it('respects disabled notification preferences', async () => {
    await evaluateAndGenerateNotifications(HOUSEHOLD_ID, USER_ID, '2026-11-23');
    const prefs = await listPreferencesForUser(USER_ID);
    const dueTodayPref = prefs.find((p) => p.notification_type === 'debt_due_today')!;

    await toggleNotificationPreference(dueTodayPref.id, false);

    await createLiability({
      householdId: HOUSEHOLD_ID,
      creditorName: 'SCB',
      debtName: 'สินเชื่อ SCB',
      debtType: 'personal_loan',
      originalPrincipal: '10000',
      outstandingBalance: '10000',
      interestRate: '10',
      interestType: 'reducing',
      minimumPayment: '1000',
      scheduledPayment: '1000',
      paymentFrequency: 'monthly',
      nextDueDate: '2026-11-23', // Today
      currencyCode: 'THB',
    });

    const notifs = await evaluateAndGenerateNotifications(
      HOUSEHOLD_ID,
      USER_ID,
      '2026-11-23'
    );
    expect(notifs.some((n) => n.notification_type === 'debt_due_today')).toBe(false);
  });
});
