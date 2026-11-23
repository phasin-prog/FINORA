import { z } from 'zod';
import { localDb } from '@/offline/indexeddb/db';

const backupSchema = z.object({
  app: z.literal('FINORA'),
  version: z.number().int().positive(),
  exportedAt: z.string(),
  data: z.object({
    accounts: z.array(z.any()),
    categories: z.array(z.any()),
    transactions: z.array(z.any()),
    journal_entries: z.array(z.any()),
    journal_lines: z.array(z.any()),
    budgets: z.array(z.any()).optional().default([]),
    liabilities: z.array(z.any()).optional().default([]),
    debt_payments: z.array(z.any()).optional().default([]),
    debt_schedules: z.array(z.any()).optional().default([]),
    calendar_events: z.array(z.any()).optional().default([]),
    notification_preferences: z.array(z.any()).optional().default([]),
    notifications: z.array(z.any()).optional().default([]),
  }),
});

export async function exportFullBackupJson(): Promise<string> {
  const [
    accounts,
    categories,
    transactions,
    journal_entries,
    journal_lines,
    budgets,
    liabilities,
    debt_payments,
    debt_schedules,
    calendar_events,
    notification_preferences,
    notifications,
  ] = await Promise.all([
    localDb.accounts.toArray(),
    localDb.categories.toArray(),
    localDb.transactions.toArray(),
    localDb.journal_entries.toArray(),
    localDb.journal_lines.toArray(),
    localDb.budgets.toArray(),
    localDb.liabilities.toArray(),
    localDb.debt_payments.toArray(),
    localDb.debt_schedules.toArray(),
    localDb.calendar_events.toArray(),
    localDb.notification_preferences.toArray(),
    localDb.notifications.toArray(),
  ]);

  return JSON.stringify(
    {
      app: 'FINORA',
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        accounts,
        categories,
        transactions,
        journal_entries,
        journal_lines,
        budgets,
        liabilities,
        debt_payments,
        debt_schedules,
        calendar_events,
        notification_preferences,
        notifications,
      },
    },
    null,
    2
  );
}

export async function restoreFullBackupJson(jsonText: string): Promise<{
  transactionsRestored: number;
  accountsRestored: number;
}> {
  const raw = JSON.parse(jsonText);
  const parsed = backupSchema.parse(raw);
  const d = parsed.data;

  await localDb.transaction(
    'rw',
    [
      localDb.accounts,
      localDb.categories,
      localDb.transactions,
      localDb.journal_entries,
      localDb.journal_lines,
      localDb.budgets,
      localDb.liabilities,
      localDb.debt_payments,
      localDb.debt_schedules,
      localDb.calendar_events,
      localDb.notification_preferences,
      localDb.notifications,
      localDb.outbox,
    ],
    async () => {
      await Promise.all([
        localDb.accounts.clear(),
        localDb.categories.clear(),
        localDb.transactions.clear(),
        localDb.journal_entries.clear(),
        localDb.journal_lines.clear(),
        localDb.budgets.clear(),
        localDb.liabilities.clear(),
        localDb.debt_payments.clear(),
        localDb.debt_schedules.clear(),
        localDb.calendar_events.clear(),
        localDb.notification_preferences.clear(),
        localDb.notifications.clear(),
        localDb.outbox.clear(),
      ]);

      if (d.accounts.length) await localDb.accounts.bulkPut(d.accounts);
      if (d.categories.length) await localDb.categories.bulkPut(d.categories);
      if (d.transactions.length) await localDb.transactions.bulkPut(d.transactions);
      if (d.journal_entries.length) await localDb.journal_entries.bulkPut(d.journal_entries);
      if (d.journal_lines.length) await localDb.journal_lines.bulkPut(d.journal_lines);
      if (d.budgets.length) await localDb.budgets.bulkPut(d.budgets);
      if (d.liabilities.length) await localDb.liabilities.bulkPut(d.liabilities);
      if (d.debt_payments.length) await localDb.debt_payments.bulkPut(d.debt_payments);
      if (d.debt_schedules.length) await localDb.debt_schedules.bulkPut(d.debt_schedules);
      if (d.calendar_events.length) await localDb.calendar_events.bulkPut(d.calendar_events);
      if (d.notification_preferences.length) {
        await localDb.notification_preferences.bulkPut(d.notification_preferences);
      }
      if (d.notifications.length) await localDb.notifications.bulkPut(d.notifications);
    }
  );

  return {
    transactionsRestored: d.transactions.length,
    accountsRestored: d.accounts.length,
  };
}
