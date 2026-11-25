-- FINORA â€” Initial Database Schema (v1.0)
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
-- FINORA â€” Accounting Integrity Triggers, RLS Policies & Onboarding Provisioning
-- PostgreSQL / Supabase Migration 0002

-- ============================================================================
-- 1. DOUBLE-ENTRY ACCOUNTING INTEGRITY TRIGGERS
-- ============================================================================

-- Verify every posted journal entry has at least 2 lines and SUM(debit) = SUM(credit).
-- Uses a CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED so all lines can be
-- inserted within the same SQL transaction before validation runs at COMMIT.
CREATE OR REPLACE FUNCTION public.check_journal_entry_balanced()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry_id UUID;
  v_status TEXT;
  v_line_count INTEGER;
  v_total_debit NUMERIC(19, 4);
  v_total_credit NUMERIC(19, 4);
BEGIN
  v_entry_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);

  SELECT status INTO v_status
  FROM public.journal_entries
  WHERE id = v_entry_id;

  IF v_status IS NULL OR v_status = 'draft' THEN
    RETURN NULL;
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(debit), 0),
    COALESCE(SUM(credit), 0)
  INTO v_line_count, v_total_debit, v_total_credit
  FROM public.journal_lines
  WHERE journal_entry_id = v_entry_id;

  IF v_line_count < 2 THEN
    RAISE EXCEPTION 'Journal entry % must have at least 2 lines (found %)', v_entry_id, v_line_count;
  END IF;

  IF v_total_debit <> v_total_credit THEN
    RAISE EXCEPTION 'Journal entry % is unbalanced: debit (%) <> credit (%)', v_entry_id, v_total_debit, v_total_credit;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_journal_entry_balanced ON public.journal_lines;
CREATE CONSTRAINT TRIGGER trg_check_journal_entry_balanced
AFTER INSERT OR UPDATE OR DELETE ON public.journal_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.check_journal_entry_balanced();

-- Prevent mutating or deleting posted/reversed journal lines (Rule: No direct edits after post)
CREATE OR REPLACE FUNCTION public.prevent_posted_journal_line_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status
  FROM public.journal_entries
  WHERE id = OLD.journal_entry_id;

  IF v_status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION 'Cannot modify or delete lines of a % journal entry (%). Use reversal instead.', v_status, OLD.journal_entry_id;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_posted_journal_line_mutation ON public.journal_lines;
CREATE TRIGGER trg_prevent_posted_journal_line_mutation
BEFORE UPDATE OR DELETE ON public.journal_lines
FOR EACH ROW
EXECUTE FUNCTION public.prevent_posted_journal_line_mutation();

-- Prevent deleting posted journal entries or changing posted_at/entry_date/description once posted
CREATE OR REPLACE FUNCTION public.prevent_posted_journal_entry_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('posted', 'reversed') THEN
      RAISE EXCEPTION 'Cannot delete a % journal entry (%).', OLD.status, OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'posted' AND NEW.status <> 'reversed' THEN
    RAISE EXCEPTION 'Posted journal entry % cannot be edited directly. Only reversal is allowed.', OLD.id;
  END IF;

  IF OLD.status = 'reversed' THEN
    RAISE EXCEPTION 'Reversed journal entry % is immutable.', OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_posted_journal_entry_mutation ON public.journal_entries;
CREATE TRIGGER trg_prevent_posted_journal_entry_mutation
BEFORE UPDATE OR DELETE ON public.journal_entries
FOR EACH ROW
EXECUTE FUNCTION public.prevent_posted_journal_entry_mutation();

-- ============================================================================
-- 2. ROW LEVEL SECURITY (RLS) HELPERS & POLICIES
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_household_member(p_household_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.household_members hm
    WHERE hm.household_id = p_household_id
      AND hm.user_id = auth.uid()
  );
$$;

-- Enable RLS on all user/financial tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.liabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debt_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debt_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debt_rate_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_operations ENABLE ROW LEVEL SECURITY;

-- Profiles & Preferences: owner only
CREATE POLICY "profiles_self" ON public.profiles
  FOR ALL USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "preferences_self" ON public.user_preferences
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "sync_devices_self" ON public.sync_devices
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Households & Members
CREATE POLICY "households_member_select" ON public.households
  FOR SELECT USING (public.is_household_member(id));

CREATE POLICY "households_owner_insert" ON public.households
  FOR INSERT WITH CHECK (created_by = auth.uid());

CREATE POLICY "households_member_update" ON public.households
  FOR UPDATE USING (public.is_household_member(id));

CREATE POLICY "household_members_select" ON public.household_members
  FOR SELECT USING (public.is_household_member(household_id));

-- Household-scoped financial tables
CREATE POLICY "ledger_accounts_household" ON public.ledger_accounts
  FOR ALL USING (public.is_household_member(household_id))
  WITH CHECK (public.is_household_member(household_id));

CREATE POLICY "accounts_household_privacy" ON public.accounts
  FOR ALL USING (
    public.is_household_member(household_id)
    AND (is_private = FALSE OR owner_user_id = auth.uid())
  )
  WITH CHECK (
    public.is_household_member(household_id)
    AND (is_private = FALSE OR owner_user_id = auth.uid())
  );

CREATE POLICY "categories_household" ON public.categories
  FOR ALL USING (public.is_household_member(household_id))
  WITH CHECK (public.is_household_member(household_id));

CREATE POLICY "transactions_household" ON public.transactions
  FOR ALL USING (public.is_household_member(household_id))
  WITH CHECK (public.is_household_member(household_id));

CREATE POLICY "transaction_transfers_household" ON public.transaction_transfers
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.id = transaction_id AND public.is_household_member(t.household_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.id = transaction_id AND public.is_household_member(t.household_id)
    )
  );

CREATE POLICY "journal_entries_household" ON public.journal_entries
  FOR ALL USING (public.is_household_member(household_id))
  WITH CHECK (public.is_household_member(household_id));

CREATE POLICY "journal_lines_household" ON public.journal_lines
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE je.id = journal_entry_id AND public.is_household_member(je.household_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE je.id = journal_entry_id AND public.is_household_member(je.household_id)
    )
  );

CREATE POLICY "budgets_household" ON public.budgets
  FOR ALL USING (public.is_household_member(household_id))
  WITH CHECK (public.is_household_member(household_id));

CREATE POLICY "assets_household" ON public.assets
  FOR ALL USING (public.is_household_member(household_id))
  WITH CHECK (public.is_household_member(household_id));

CREATE POLICY "liabilities_household" ON public.liabilities
  FOR ALL USING (public.is_household_member(household_id))
  WITH CHECK (public.is_household_member(household_id));

CREATE POLICY "debt_payments_household" ON public.debt_payments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.liabilities l
      WHERE l.id = liability_id AND public.is_household_member(l.household_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.liabilities l
      WHERE l.id = liability_id AND public.is_household_member(l.household_id)
    )
  );

CREATE POLICY "debt_schedules_household" ON public.debt_schedules
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.liabilities l
      WHERE l.id = liability_id AND public.is_household_member(l.household_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.liabilities l
      WHERE l.id = liability_id AND public.is_household_member(l.household_id)
    )
  );

CREATE POLICY "debt_rate_history_household" ON public.debt_rate_history
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.liabilities l
      WHERE l.id = liability_id AND public.is_household_member(l.household_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.liabilities l
      WHERE l.id = liability_id AND public.is_household_member(l.household_id)
    )
  );

CREATE POLICY "recurring_rules_household" ON public.recurring_rules
  FOR ALL USING (public.is_household_member(household_id))
  WITH CHECK (public.is_household_member(household_id));

CREATE POLICY "attachments_household" ON public.attachments
  FOR ALL USING (public.is_household_member(household_id))
  WITH CHECK (public.is_household_member(household_id));

CREATE POLICY "audit_logs_household_select" ON public.audit_logs
  FOR SELECT USING (public.is_household_member(household_id));

CREATE POLICY "audit_logs_household_insert" ON public.audit_logs
  FOR INSERT WITH CHECK (public.is_household_member(household_id));

CREATE POLICY "sync_operations_household" ON public.sync_operations
  FOR ALL USING (public.is_household_member(household_id))
  WITH CHECK (public.is_household_member(household_id));

-- ============================================================================
-- 3. AUTO-PROVISION PERSONAL HOUSEHOLD & DEFAULT CHART OF ACCOUNTS ON SIGNUP
-- ============================================================================

CREATE OR REPLACE FUNCTION public.provision_personal_household(
  p_user_id UUID,
  p_display_name TEXT DEFAULT 'Personal'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_household_id UUID;
  v_la_cash UUID;
  v_la_bank UUID;
  v_la_wallet UUID;
  v_la_invest UUID;
  v_la_cc UUID;
  v_la_salary UUID;
  v_la_freelance UUID;
  v_la_dividend UUID;
  v_la_food UUID;
  v_la_transport UUID;
  v_la_housing UUID;
  v_la_personal UUID;
  v_la_interest UUID;
  v_la_misc UUID;
BEGIN
  INSERT INTO public.profiles (id, display_name, locale)
  VALUES (p_user_id, COALESCE(NULLIF(p_display_name, ''), 'FINORA User'), 'th-TH')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_preferences (user_id, theme)
  VALUES (p_user_id, 'system')
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.households (name, base_currency, created_by)
  VALUES ('Personal Finance', 'THB', p_user_id)
  RETURNING id INTO v_household_id;

  INSERT INTO public.household_members (household_id, user_id, role)
  VALUES (v_household_id, p_user_id, 'OWNER');

  -- Chart of Accounts (Section 3.2)
  INSERT INTO public.ledger_accounts (household_id, code, name, account_class, is_system) VALUES
    (v_household_id, '1100', 'Cash', 'ASSET', TRUE),
    (v_household_id, '1200', 'Bank Accounts', 'ASSET', TRUE),
    (v_household_id, '1300', 'E-Wallet', 'ASSET', TRUE),
    (v_household_id, '1400', 'Investments', 'ASSET', TRUE),
    (v_household_id, '2100', 'Credit Card', 'LIABILITY', TRUE),
    (v_household_id, '2200', 'Personal Loan', 'LIABILITY', TRUE),
    (v_household_id, '3100', 'Opening Balance Equity', 'EQUITY', TRUE),
    (v_household_id, '3200', 'Owner Equity', 'EQUITY', TRUE),
    (v_household_id, '4100', 'Employment / Salary', 'INCOME', TRUE),
    (v_household_id, '4200', 'Freelance', 'INCOME', TRUE),
    (v_household_id, '4400', 'Investment Income', 'INCOME', TRUE),
    (v_household_id, '5100', 'Housing', 'EXPENSE', TRUE),
    (v_household_id, '5200', 'Food & Dining', 'EXPENSE', TRUE),
    (v_household_id, '5300', 'Transportation', 'EXPENSE', TRUE),
    (v_household_id, '5400', 'Personal Care', 'EXPENSE', TRUE),
    (v_household_id, '5500', 'Financial Costs & Interest', 'EXPENSE', TRUE),
    (v_household_id, '5900', 'Miscellaneous', 'EXPENSE', TRUE);

  SELECT id INTO v_la_cash FROM public.ledger_accounts WHERE household_id = v_household_id AND code = '1100';
  SELECT id INTO v_la_bank FROM public.ledger_accounts WHERE household_id = v_household_id AND code = '1200';
  SELECT id INTO v_la_wallet FROM public.ledger_accounts WHERE household_id = v_household_id AND code = '1300';
  SELECT id INTO v_la_invest FROM public.ledger_accounts WHERE household_id = v_household_id AND code = '1400';
  SELECT id INTO v_la_cc FROM public.ledger_accounts WHERE household_id = v_household_id AND code = '2100';
  SELECT id INTO v_la_salary FROM public.ledger_accounts WHERE household_id = v_household_id AND code = '4100';
  SELECT id INTO v_la_freelance FROM public.ledger_accounts WHERE household_id = v_household_id AND code = '4200';
  SELECT id INTO v_la_dividend FROM public.ledger_accounts WHERE household_id = v_household_id AND code = '4400';
  SELECT id INTO v_la_housing FROM public.ledger_accounts WHERE household_id = v_household_id AND code = '5100';
  SELECT id INTO v_la_food FROM public.ledger_accounts WHERE household_id = v_household_id AND code = '5200';
  SELECT id INTO v_la_transport FROM public.ledger_accounts WHERE household_id = v_household_id AND code = '5300';
  SELECT id INTO v_la_personal FROM public.ledger_accounts WHERE household_id = v_household_id AND code = '5400';
  SELECT id INTO v_la_interest FROM public.ledger_accounts WHERE household_id = v_household_id AND code = '5500';
  SELECT id INTO v_la_misc FROM public.ledger_accounts WHERE household_id = v_household_id AND code = '5900';

  -- Default starter accounts
  INSERT INTO public.accounts (household_id, ledger_account_id, name, account_type, currency_code, opening_balance, owner_user_id)
  VALUES
    (v_household_id, v_la_cash, 'à¹€à¸‡à¸´à¸™à¸ªà¸” (Cash)', 'cash', 'THB', 0, p_user_id),
    (v_household_id, v_la_bank, 'à¸šà¸±à¸à¸Šà¸µà¸˜à¸™à¸²à¸„à¸²à¸£à¸«à¸¥à¸±à¸ (Main Bank)', 'bank', 'THB', 0, p_user_id);

  -- Default categories
  INSERT INTO public.categories (household_id, ledger_account_id, name, category_type, icon, color, sort_order, is_system)
  VALUES
    (v_household_id, v_la_salary, 'à¹€à¸‡à¸´à¸™à¹€à¸”à¸·à¸­à¸™ (Salary)', 'INCOME', 'banknote', '#39846C', 1, TRUE),
    (v_household_id, v_la_freelance, 'à¸Ÿà¸£à¸µà¹à¸¥à¸™à¸‹à¹Œ (Freelance)', 'INCOME', 'briefcase', '#39846C', 2, TRUE),
    (v_household_id, v_la_dividend, 'à¹€à¸‡à¸´à¸™à¸›à¸±à¸™à¸œà¸¥ (Dividends)', 'INCOME', 'trending-up', '#39846C', 3, TRUE),
    (v_household_id, v_la_food, 'à¸­à¸²à¸«à¸²à¸£à¹à¸¥à¸°à¹€à¸„à¸£à¸·à¹ˆà¸­à¸‡à¸”à¸·à¹ˆà¸¡ (Food)', 'EXPENSE', 'utensils', '#202B27', 10, TRUE),
    (v_household_id, v_la_transport, 'à¸à¸²à¸£à¹€à¸”à¸´à¸™à¸—à¸²à¸‡ (Transport)', 'EXPENSE', 'car', '#202B27', 20, TRUE),
    (v_household_id, v_la_housing, 'à¸—à¸µà¹ˆà¸­à¸¢à¸¹à¹ˆà¸­à¸²à¸¨à¸±à¸¢ (Housing)', 'EXPENSE', 'home', '#202B27', 30, TRUE),
    (v_household_id, v_la_personal, 'à¸ªà¹ˆà¸§à¸™à¸•à¸±à¸§ (Personal)', 'EXPENSE', 'user', '#202B27', 40, TRUE),
    (v_household_id, v_la_interest, 'à¸”à¸­à¸à¹€à¸šà¸µà¹‰à¸¢à¹à¸¥à¸°à¸„à¹ˆà¸²à¸˜à¸£à¸£à¸¡à¹€à¸™à¸µà¸¢à¸¡', 'EXPENSE', 'percent', '#C28B48', 50, TRUE),
    (v_household_id, v_la_misc, 'à¸­à¸·à¹ˆà¸™à¹† (Miscellaneous)', 'EXPENSE', 'more-horizontal', '#858B85', 90, TRUE),
    (v_household_id, NULL, 'à¹‚à¸­à¸™à¹€à¸‡à¸´à¸™à¸£à¸°à¸«à¸§à¹ˆà¸²à¸‡à¸šà¸±à¸à¸Šà¸µ (Transfer)', 'TRANSFER', 'repeat', '#858B85', 100, TRUE);

  RETURN v_household_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.provision_personal_household(
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();
-- FINORA â€” Atomic Transaction Posting & Reversal RPCs
-- PostgreSQL / Supabase Migration 0003
-- Guarantees:
--   1. Idempotency via (household_id, idempotency_key)
--   2. Authorization via is_household_member(household_id)
--   3. Single DB transaction for transaction + transfer + journal_entry + journal_lines
--   4. Immutability of posted transactions (reversal only)

CREATE OR REPLACE FUNCTION public.post_finora_transaction(
  p_id UUID,
  p_household_id UUID,
  p_account_id UUID,
  p_to_account_id UUID,
  p_category_id UUID,
  p_transaction_type TEXT,
  p_amount NUMERIC(19, 4),
  p_currency_code CHAR(3),
  p_transaction_date DATE,
  p_description TEXT,
  p_idempotency_key UUID,
  p_notes TEXT DEFAULT NULL,
  p_tags TEXT[] DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_existing_tx RECORD;
  v_account RECORD;
  v_to_account RECORD;
  v_category RECORD;
  v_journal_id UUID;
  v_debit_ledger_id UUID;
  v_credit_ledger_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_household_member(p_household_id) THEN
    RAISE EXCEPTION 'Access denied for household %', p_household_id;
  END IF;

  -- Idempotency check
  SELECT id, journal_entry_id, status
  INTO v_existing_tx
  FROM public.transactions
  WHERE household_id = p_household_id
    AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'transaction_id', v_existing_tx.id,
      'journal_entry_id', v_existing_tx.journal_entry_id,
      'status', v_existing_tx.status,
      'idempotent_replay', TRUE
    );
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;

  SELECT id, household_id, ledger_account_id, name
  INTO v_account
  FROM public.accounts
  WHERE id = p_account_id AND household_id = p_household_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account % not found in household %', p_account_id, p_household_id;
  END IF;

  IF p_transaction_type = 'transfer' THEN
    IF p_to_account_id IS NULL OR p_to_account_id = p_account_id THEN
      RAISE EXCEPTION 'Valid destination account required for transfer';
    END IF;

    SELECT id, household_id, ledger_account_id, name
    INTO v_to_account
    FROM public.accounts
    WHERE id = p_to_account_id AND household_id = p_household_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Destination account % not found in household %', p_to_account_id, p_household_id;
    END IF;

    v_debit_ledger_id := v_to_account.ledger_account_id;
    v_credit_ledger_id := v_account.ledger_account_id;
  ELSE
    SELECT id, household_id, ledger_account_id, category_type, name
    INTO v_category
    FROM public.categories
    WHERE id = p_category_id AND household_id = p_household_id;

    IF NOT FOUND OR v_category.ledger_account_id IS NULL THEN
      RAISE EXCEPTION 'Valid category with ledger account required';
    END IF;

    IF p_transaction_type = 'income' THEN
      IF v_category.category_type <> 'INCOME' THEN
        RAISE EXCEPTION 'Income transaction requires INCOME category';
      END IF;
      v_debit_ledger_id := v_account.ledger_account_id;
      v_credit_ledger_id := v_category.ledger_account_id;
    ELSIF p_transaction_type = 'expense' THEN
      IF v_category.category_type <> 'EXPENSE' THEN
        RAISE EXCEPTION 'Expense transaction requires EXPENSE category';
      END IF;
      v_debit_ledger_id := v_category.ledger_account_id;
      v_credit_ledger_id := v_account.ledger_account_id;
    ELSE
      RAISE EXCEPTION 'Unsupported transaction type: %', p_transaction_type;
    END IF;
  END IF;

  -- Insert transaction as posted
  INSERT INTO public.transactions (
    id, household_id, created_by, account_id, category_id,
    transaction_type, amount, currency_code, transaction_date,
    description, status, idempotency_key, notes, tags
  ) VALUES (
    COALESCE(p_id, gen_random_uuid()),
    p_household_id, v_user_id, p_account_id, p_category_id,
    p_transaction_type, p_amount, UPPER(p_currency_code), p_transaction_date,
    COALESCE(p_description, ''), 'posted', p_idempotency_key, p_notes, COALESCE(p_tags, '{}')
  )
  RETURNING id INTO p_id;

  IF p_transaction_type = 'transfer' THEN
    INSERT INTO public.transaction_transfers (transaction_id, from_account_id, to_account_id)
    VALUES (p_id, p_account_id, p_to_account_id);
  END IF;

  -- Create balanced journal entry + 2 lines atomically
  INSERT INTO public.journal_entries (
    household_id, transaction_id, entry_date, description, status, posted_at
  ) VALUES (
    p_household_id, p_id, p_transaction_date, COALESCE(p_description, ''), 'posted', NOW()
  )
  RETURNING id INTO v_journal_id;

  INSERT INTO public.journal_lines (
    journal_entry_id, ledger_account_id, debit, credit, currency_code, description
  ) VALUES
    (v_journal_id, v_debit_ledger_id, p_amount, 0, UPPER(p_currency_code), COALESCE(p_description, '')),
    (v_journal_id, v_credit_ledger_id, 0, p_amount, UPPER(p_currency_code), COALESCE(p_description, ''));

  UPDATE public.transactions
  SET journal_entry_id = v_journal_id, updated_at = NOW()
  WHERE id = p_id;

  INSERT INTO public.audit_logs (household_id, actor_user_id, entity_type, entity_id, action, payload)
  VALUES (
    p_household_id, v_user_id, 'transaction', p_id, 'POST',
    jsonb_build_object('journal_entry_id', v_journal_id, 'amount', p_amount, 'type', p_transaction_type)
  );

  RETURN jsonb_build_object(
    'transaction_id', p_id,
    'journal_entry_id', v_journal_id,
    'status', 'posted',
    'idempotent_replay', FALSE
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_finora_transaction(
  p_original_transaction_id UUID,
  p_reversal_transaction_id UUID,
  p_reversal_date DATE,
  p_idempotency_key UUID,
  p_reason TEXT DEFAULT 'User reversal'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_orig RECORD;
  v_existing RECORD;
  v_rev_journal_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_orig
  FROM public.transactions
  WHERE id = p_original_transaction_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original transaction % not found', p_original_transaction_id;
  END IF;

  IF NOT public.is_household_member(v_orig.household_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Idempotency check
  SELECT id, journal_entry_id, status INTO v_existing
  FROM public.transactions
  WHERE household_id = v_orig.household_id
    AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'reversal_transaction_id', v_existing.id,
      'reversal_journal_id', v_existing.journal_entry_id,
      'idempotent_replay', TRUE
    );
  END IF;

  IF v_orig.status <> 'posted' THEN
    RAISE EXCEPTION 'Only posted transactions can be reversed (current status: %)', v_orig.status;
  END IF;

  -- Mark original transaction as reversed
  UPDATE public.transactions
  SET status = 'reversed', updated_at = NOW()
  WHERE id = v_orig.id;

  UPDATE public.journal_entries
  SET status = 'reversed'
  WHERE id = v_orig.journal_entry_id;

  -- Create reversal transaction record
  INSERT INTO public.transactions (
    id, household_id, created_by, account_id, category_id,
    transaction_type, amount, currency_code, transaction_date,
    description, status, idempotency_key, reversed_transaction_id
  ) VALUES (
    COALESCE(p_reversal_transaction_id, gen_random_uuid()),
    v_orig.household_id, v_user_id, v_orig.account_id, v_orig.category_id,
    v_orig.transaction_type, v_orig.amount, v_orig.currency_code, p_reversal_date,
    'Reversal (' || COALESCE(p_reason, 'User reversal') || '): ' || v_orig.description,
    'posted', p_idempotency_key, v_orig.id
  )
  RETURNING id INTO p_reversal_transaction_id;

  INSERT INTO public.journal_entries (
    household_id, transaction_id, entry_date, description, status, posted_at
  ) VALUES (
    v_orig.household_id, p_reversal_transaction_id, p_reversal_date,
    'Reversal: ' || v_orig.description, 'posted', NOW()
  )
  RETURNING id INTO v_rev_journal_id;

  -- Swap debit and credit from original journal lines
  INSERT INTO public.journal_lines (
    journal_entry_id, ledger_account_id, debit, credit, currency_code, description
  )
  SELECT
    v_rev_journal_id,
    jl.ledger_account_id,
    jl.credit,
    jl.debit,
    jl.currency_code,
    'Reversal: ' || jl.description
  FROM public.journal_lines jl
  WHERE jl.journal_entry_id = v_orig.journal_entry_id;

  UPDATE public.transactions
  SET journal_entry_id = v_rev_journal_id, updated_at = NOW()
  WHERE id = p_reversal_transaction_id;

  INSERT INTO public.audit_logs (household_id, actor_user_id, entity_type, entity_id, action, payload)
  VALUES (
    v_orig.household_id, v_user_id, 'transaction', v_orig.id, 'REVERSE',
    jsonb_build_object('reversal_transaction_id', p_reversal_transaction_id, 'reason', p_reason)
  );

  RETURN jsonb_build_object(
    'reversal_transaction_id', p_reversal_transaction_id,
    'reversal_journal_id', v_rev_journal_id,
    'idempotent_replay', FALSE
  );
END;
$$;
-- FINORA v1.1 Addendum â€” Notification Center & Monthly Financial Calendar
-- PostgreSQL / Supabase Migration 0004

-- 1. Calendar Events
CREATE TABLE IF NOT EXISTS public.calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('INCOME', 'EXPENSE', 'DEBT_PAYMENT', 'INVESTMENT', 'BILL', 'REMINDER', 'CUSTOM')
  ),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  event_date DATE NOT NULL,
  amount NUMERIC(19, 4) CHECK (amount IS NULL OR amount >= 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'THB',
  related_transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  related_liability_id UUID REFERENCES public.liabilities(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'recurring', 'liability', 'transaction')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'overdue')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Notification Preferences
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  days_before INTEGER NOT NULL DEFAULT 0 CHECK (days_before >= 0),
  preferred_time TIME NOT NULL DEFAULT '08:00:00',
  channel TEXT NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app', 'web_push', 'both')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, notification_type, days_before)
);

-- 3. Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.calendar_events(id) ON DELETE SET NULL,
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('urgent', 'important', 'informational', 'system')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sent', 'read', 'cancelled')),
  deduplication_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, deduplication_key)
);

-- 4. Web Push Subscriptions
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_calendar_events_household_date
  ON public.calendar_events(household_id, event_date);
CREATE INDEX IF NOT EXISTS idx_notifications_user_status
  ON public.notifications(user_id, status, scheduled_at DESC);

-- RLS Policies
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "calendar_events_household" ON public.calendar_events
  FOR ALL USING (public.is_household_member(household_id))
  WITH CHECK (public.is_household_member(household_id));

CREATE POLICY "notification_preferences_self" ON public.notification_preferences
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "notifications_self" ON public.notifications
  FOR ALL USING (user_id = auth.uid() AND public.is_household_member(household_id))
  WITH CHECK (user_id = auth.uid() AND public.is_household_member(household_id));

CREATE POLICY "push_subscriptions_self" ON public.push_subscriptions
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
-- FINORA v1.2 â€” Account Number & Icon Metadata
-- PostgreSQL / Supabase Migration 0005

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS account_number TEXT,
  ADD COLUMN IF NOT EXISTS icon TEXT;
