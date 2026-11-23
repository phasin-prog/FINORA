export type CalendarEventType =
  | 'INCOME'
  | 'EXPENSE'
  | 'DEBT_PAYMENT'
  | 'INVESTMENT'
  | 'BILL'
  | 'REMINDER'
  | 'CUSTOM';

export type CalendarEventSource = 'manual' | 'recurring' | 'liability' | 'transaction';

export type CalendarEventStatus = 'scheduled' | 'completed' | 'cancelled' | 'overdue';

export interface CalendarEventRecord {
  id: string;
  household_id: string;
  owner_user_id: string | null;
  event_type: CalendarEventType;
  title: string;
  description: string;
  event_date: string; // YYYY-MM-DD (Asia/Bangkok calendar date)
  amount: string | null; // NUMERIC string
  currency_code: string;
  related_transaction_id: string | null;
  related_liability_id: string | null;
  source_type: CalendarEventSource;
  status: CalendarEventStatus;
  created_at: string;
  updated_at: string;
}

export interface CalendarDisplayItem {
  id: string;
  event_type: CalendarEventType;
  title: string;
  description: string;
  event_date: string;
  amount: string | null;
  currency_code: string;
  is_actual: boolean; // true = posted transaction, false = expected/scheduled
  status: CalendarEventStatus;
  related_transaction_id: string | null;
  related_liability_id: string | null;
}

export interface MonthlyFinancialSummary {
  monthKey: string; // YYYY-MM
  expectedIncome: string;
  actualIncome: string;
  expectedExpenses: string;
  actualExpenses: string;
  upcomingPayments: string;
  netCashFlow: string; // actualIncome - actualExpenses
}
