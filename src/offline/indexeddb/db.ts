import Dexie, { type Table } from 'dexie';
import type {
  Budget,
  Category,
  DebtPayment,
  DebtSchedule,
  FinancialAccount,
  JournalEntry,
  JournalLine,
  Liability,
  SyncStatus,
  Transaction,
} from '@/types/financial';
import type { CalendarEventRecord } from '@/modules/calendar/calendar.types';
import type {
  NotificationPreferenceRecord,
  NotificationRecord,
} from '@/modules/notifications/notification.types';

export interface OutboxItem {
  id: string;
  household_id: string;
  entity_type: 'transaction' | 'account' | 'budget' | 'liability';
  entity_id: string;
  operation: 'create' | 'update' | 'reverse' | 'cancel';
  idempotency_key: string;
  payload: Record<string, unknown>;
  sync_status: SyncStatus;
  retry_count: number;
  last_error?: string;
  created_at: string;
  updated_at: string;
}

export class FinoraLocalDB extends Dexie {
  accounts!: Table<FinancialAccount, string>;
  categories!: Table<Category, string>;
  transactions!: Table<Transaction, string>;
  journal_entries!: Table<JournalEntry, string>;
  journal_lines!: Table<JournalLine, string>;
  outbox!: Table<OutboxItem, string>;
  budgets!: Table<Budget, string>;
  liabilities!: Table<Liability, string>;
  debt_payments!: Table<DebtPayment, string>;
  debt_schedules!: Table<DebtSchedule, string>;
  calendar_events!: Table<CalendarEventRecord, string>;
  notification_preferences!: Table<NotificationPreferenceRecord, string>;
  notifications!: Table<NotificationRecord, string>;

  constructor() {
    super('finora_local_db');
    this.version(1).stores({
      accounts: 'id, household_id, account_type, is_active',
      categories: 'id, household_id, category_type, parent_id, sort_order',
      transactions:
        'id, household_id, transaction_date, account_id, category_id, status, sync_status, idempotency_key',
      journal_entries: 'id, household_id, transaction_id, entry_date, status',
      journal_lines: 'id, journal_entry_id, ledger_account_id',
      outbox: 'id, household_id, entity_id, sync_status, created_at',
    });

    this.version(2).stores({
      budgets: 'id, household_id, category_id, period_type, period_start, period_end',
      liabilities: 'id, household_id, debt_type, status, next_due_date',
      debt_payments: 'id, liability_id, payment_date',
    });

    this.version(3).stores({
      calendar_events: 'id, household_id, event_date, event_type, status, related_liability_id',
      notification_preferences: 'id, user_id, notification_type, is_enabled',
      notifications: 'id, user_id, household_id, status, priority, scheduled_at, deduplication_key',
    });

    this.version(4).stores({
      debt_schedules: 'id, liability_id, installment_no, due_date, is_paid',
    });
  }
}

export const localDb = new FinoraLocalDB();
