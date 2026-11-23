-- FINORA — Initial Database Schema (v1.0)
-- PostgreSQL / Supabase Migration 0001
-- Strict rules:
--   - UUID Primary Keys everywhere
--   - NUMERIC(19,4) for all monetary amounts (NEVER FLOAT/DOUBLE PRECISION)
--   - Household-scoped multi-tenant design from day 1 (starts with 1 personal household)
--   - Double-Entry Accounting Ledger with DB-level balance & immutability enforcement

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- A. IDENTITY & HOUSEHOLD
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  locale TEXT NOT NULL DEFAULT 'th-TH',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.households (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  base_currency CHAR(3) NOT NULL DEFAULT 'THB',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.household_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (household_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- B. CHART OF ACCOUNTS (LEDGER) & FINANCIAL ACCOUNTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ledger_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  account_class TEXT NOT NULL CHECK (account_class IN ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE')),
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (household_id, code)
);

CREATE TABLE IF NOT EXISTS public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  ledger_account_id UUID NOT NULL REFERENCES public.ledger_accounts(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('cash', 'bank', 'wallet', 'investment', 'credit_card', 'loan')),
  institution TEXT,
  currency_code CHAR(3) NOT NULL DEFAULT 'THB',
  opening_balance NUMERIC(19, 4) NOT NULL DEFAULT 0,
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_private BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- C. CATEGORIES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  ledger_account_id UUID REFERENCES public.ledger_accounts(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  category_type TEXT NOT NULL CHECK (category_type IN ('INCOME', 'EXPENSE', 'TRANSFER', 'INVESTMENT')),
  icon TEXT,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- D. TRANSACTIONS (USER-FACING SINGLE-ENTRY UX)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  category_id UUID REFERENCES public.categories(id) ON DELETE RESTRICT,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('income', 'expense', 'transfer')),
  amount NUMERIC(19, 4) NOT NULL CHECK (amount > 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'THB',
  transaction_date DATE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'posted', 'cancelled', 'reversed')),
  idempotency_key UUID NOT NULL,
  journal_entry_id UUID,
  reversed_transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  notes TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (household_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.transaction_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL UNIQUE REFERENCES public.transactions(id) ON DELETE CASCADE,
  from_account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  to_account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  CHECK (from_account_id <> to_account_id)
);

-- ============================================================================
-- E. ACCOUNTING LEDGER (DOUBLE-ENTRY ENGINE)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE RESTRICT,
  entry_date DATE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('draft', 'posted', 'reversed')),
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.transactions
  ADD CONSTRAINT fk_transactions_journal_entry
  FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS public.journal_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  ledger_account_id UUID NOT NULL REFERENCES public.ledger_accounts(id) ON DELETE RESTRICT,
  debit NUMERIC(19, 4) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit NUMERIC(19, 4) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'THB',
  description TEXT NOT NULL DEFAULT '',
  CHECK (NOT (debit > 0 AND credit > 0)),
  CHECK (debit > 0 OR credit > 0)
);

-- ============================================================================
-- F. BUDGETS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.categories(id) ON DELETE CASCADE,
  period_type TEXT NOT NULL CHECK (period_type IN ('weekly', 'monthly', 'annual')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  budget_amount NUMERIC(19, 4) NOT NULL CHECK (budget_amount >= 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'THB',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end >= period_start)
);

-- ============================================================================
-- G. ASSETS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  asset_name TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('cash', 'deposit', 'investment', 'gold', 'property', 'vehicle', 'other')),
  acquisition_date DATE,
  acquisition_cost NUMERIC(19, 4) NOT NULL DEFAULT 0 CHECK (acquisition_cost >= 0),
  current_value NUMERIC(19, 4) NOT NULL DEFAULT 0 CHECK (current_value >= 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'THB',
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  valuation_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- H. LIABILITIES & DEBT TRACKING
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.liabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  creditor_name TEXT NOT NULL,
  debt_name TEXT NOT NULL,
  debt_type TEXT NOT NULL CHECK (debt_type IN ('credit_card', 'personal_loan', 'vehicle_loan', 'mortgage', 'other')),
  original_principal NUMERIC(19, 4) NOT NULL CHECK (original_principal >= 0),
  outstanding_balance NUMERIC(19, 4) NOT NULL CHECK (outstanding_balance >= 0),
  interest_rate NUMERIC(7, 4) NOT NULL DEFAULT 0 CHECK (interest_rate >= 0),
  interest_type TEXT NOT NULL DEFAULT 'reducing' CHECK (interest_type IN ('fixed', 'reducing', 'zero')),
  minimum_payment NUMERIC(19, 4) NOT NULL DEFAULT 0 CHECK (minimum_payment >= 0),
  scheduled_payment NUMERIC(19, 4) NOT NULL DEFAULT 0 CHECK (scheduled_payment >= 0),
  payment_frequency TEXT NOT NULL DEFAULT 'monthly' CHECK (payment_frequency IN ('weekly', 'monthly', 'quarterly', 'annual')),
  next_due_date DATE,
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'THB',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paid_off', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.debt_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  liability_id UUID NOT NULL REFERENCES public.liabilities(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  payment_date DATE NOT NULL,
  principal_paid NUMERIC(19, 4) NOT NULL DEFAULT 0 CHECK (principal_paid >= 0),
  interest_paid NUMERIC(19, 4) NOT NULL DEFAULT 0 CHECK (interest_paid >= 0),
  total_paid NUMERIC(19, 4) NOT NULL CHECK (total_paid > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.debt_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  liability_id UUID NOT NULL REFERENCES public.liabilities(id) ON DELETE CASCADE,
  installment_no INTEGER NOT NULL CHECK (installment_no > 0),
  due_date DATE NOT NULL,
  principal_due NUMERIC(19, 4) NOT NULL DEFAULT 0 CHECK (principal_due >= 0),
  interest_due NUMERIC(19, 4) NOT NULL DEFAULT 0 CHECK (interest_due >= 0),
  is_paid BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (liability_id, installment_no)
);

CREATE TABLE IF NOT EXISTS public.debt_rate_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  liability_id UUID NOT NULL REFERENCES public.liabilities(id) ON DELETE CASCADE,
  effective_date DATE NOT NULL,
  interest_rate NUMERIC(7, 4) NOT NULL CHECK (interest_rate >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- I. SUPPORTING TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.recurring_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('income', 'expense', 'transfer')),
  amount NUMERIC(19, 4) NOT NULL CHECK (amount > 0),
  description TEXT NOT NULL DEFAULT '',
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  next_run_date DATE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sync_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_label TEXT NOT NULL,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sync_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  device_id UUID REFERENCES public.sync_devices(id) ON DELETE SET NULL,
  idempotency_key UUID NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'synced', 'conflict', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (household_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.exchange_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_currency CHAR(3) NOT NULL,
  quote_currency CHAR(3) NOT NULL,
  rate NUMERIC(19, 8) NOT NULL CHECK (rate > 0),
  rate_date DATE NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  UNIQUE (base_currency, quote_currency, rate_date)
);

-- ============================================================================
-- J. PERFORMANCE INDEXES (Section 4.3)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_household_members_user ON public.household_members(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_accounts_household ON public.ledger_accounts(household_id);
CREATE INDEX IF NOT EXISTS idx_accounts_household ON public.accounts(household_id);
CREATE INDEX IF NOT EXISTS idx_categories_household ON public.categories(household_id);

CREATE INDEX IF NOT EXISTS idx_transactions_household_date ON public.transactions(household_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON public.transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON public.transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON public.transactions(household_id, status);

CREATE INDEX IF NOT EXISTS idx_journal_entries_household_date ON public.journal_entries(household_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON public.journal_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_ledger_account ON public.journal_lines(ledger_account_id);

CREATE INDEX IF NOT EXISTS idx_budgets_household_period ON public.budgets(household_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_audit_logs_household_created ON public.audit_logs(household_id, created_at DESC);
