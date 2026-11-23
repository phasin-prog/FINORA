export type AccountClass = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';

export type AccountType =
  | 'cash'
  | 'bank'
  | 'wallet'
  | 'investment'
  | 'credit_card'
  | 'loan';

export type TransactionType = 'income' | 'expense' | 'transfer';

export type TransactionStatus =
  | 'draft'
  | 'pending'
  | 'posted'
  | 'cancelled'
  | 'reversed';

/**
 * Sync status is strictly separated from TransactionStatus (Section 3.3).
 * Example: a transaction can be 'posted' locally while 'sync_pending' to Cloud.
 */
export type SyncStatus = 'synced' | 'sync_pending' | 'sync_failed' | 'conflict';

export type JournalStatus = 'draft' | 'posted' | 'reversed';

export interface LedgerAccount {
  id: string;
  household_id: string;
  parent_id: string | null;
  code: string;
  name: string;
  account_class: AccountClass;
  is_system: boolean;
  is_active: boolean;
}

export interface FinancialAccount {
  id: string;
  household_id: string;
  ledger_account_id: string;
  account_class: AccountClass;
  name: string;
  account_type: AccountType;
  institution?: string | null;
  currency_code: string;
  opening_balance: string; // NUMERIC string, never float
  owner_user_id?: string | null;
  is_private: boolean;
  is_active: boolean;
}

export interface Category {
  id: string;
  household_id: string;
  parent_id: string | null;
  ledger_account_id: string | null;
  name: string;
  category_type: 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'INVESTMENT';
  icon?: string | null;
  color?: string | null;
  sort_order: number;
  is_system: boolean;
  is_active: boolean;
}

export interface Transaction {
  id: string;
  household_id: string;
  created_by: string;
  account_id: string;
  category_id: string | null;
  transaction_type: TransactionType;
  amount: string; // NUMERIC string
  currency_code: string;
  transaction_date: string; // YYYY-MM-DD
  description: string;
  status: TransactionStatus;
  sync_status: SyncStatus;
  idempotency_key: string;
  journal_entry_id: string | null;
  reversed_transaction_id: string | null;
  notes?: string | null;
  tags?: string[];
  created_at: string;
  updated_at: string;
}

export interface JournalLineInput {
  ledger_account_id: string;
  debit: string;
  credit: string;
  currency_code: string;
  description: string;
}

export interface JournalLine extends JournalLineInput {
  id: string;
  journal_entry_id: string;
}

export interface JournalEntry {
  id: string;
  household_id: string;
  transaction_id: string | null;
  entry_date: string;
  description: string;
  status: JournalStatus;
  posted_at: string | null;
  created_at: string;
}

export interface JournalEntryDraft {
  household_id: string;
  transaction_id: string;
  entry_date: string;
  description: string;
  status: 'posted';
  lines: JournalLineInput[];
}

export type BudgetPeriodType = 'weekly' | 'monthly' | 'annual';

export interface Budget {
  id: string;
  household_id: string;
  category_id: string | null; // null = total household budget
  period_type: BudgetPeriodType;
  period_start: string; // YYYY-MM-DD
  period_end: string; // YYYY-MM-DD
  budget_amount: string; // NUMERIC string
  currency_code: string;
  created_at: string;
  updated_at: string;
}

export type DebtType =
  | 'credit_card'
  | 'personal_loan'
  | 'vehicle_loan'
  | 'mortgage'
  | 'other';

export type LiabilityStatus = 'active' | 'paid_off' | 'closed';

export interface Liability {
  id: string;
  household_id: string;
  account_id: string | null;
  creditor_name: string;
  debt_name: string;
  debt_type: DebtType;
  original_principal: string;
  outstanding_balance: string;
  interest_rate: string; // annual % e.g. "16.0000"
  interest_type: 'fixed' | 'reducing' | 'zero';
  minimum_payment: string;
  scheduled_payment: string;
  payment_frequency: 'weekly' | 'monthly' | 'quarterly' | 'annual';
  next_due_date: string | null;
  currency_code: string;
  status: LiabilityStatus;
  created_at: string;
  updated_at: string;
}

export interface DebtPayment {
  id: string;
  liability_id: string;
  transaction_id: string | null;
  payment_date: string;
  principal_paid: string;
  interest_paid: string;
  total_paid: string;
  created_at: string;
}
