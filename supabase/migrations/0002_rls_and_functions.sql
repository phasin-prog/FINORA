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
DROP POLICY IF EXISTS "profiles_self" ON public.profiles;
CREATE POLICY "profiles_self" ON public.profiles
  FOR ALL USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "preferences_self" ON public.user_preferences;
CREATE POLICY "preferences_self" ON public.user_preferences
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "sync_devices_self" ON public.sync_devices;
CREATE POLICY "sync_devices_self" ON public.sync_devices
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Households & Members
DROP POLICY IF EXISTS "households_member_select" ON public.households;
CREATE POLICY "households_member_select" ON public.households
  FOR SELECT USING (public.is_household_member(id));

DROP POLICY IF EXISTS "households_owner_insert" ON public.households;
CREATE POLICY "households_owner_insert" ON public.households
  FOR INSERT WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "households_member_update" ON public.households;
CREATE POLICY "households_member_update" ON public.households
  FOR UPDATE USING (public.is_household_member(id));

DROP POLICY IF EXISTS "household_members_select" ON public.household_members;
CREATE POLICY "household_members_select" ON public.household_members
  FOR SELECT USING (public.is_household_member(household_id));

-- Household-scoped financial tables
DROP POLICY IF EXISTS "ledger_accounts_household" ON public.ledger_accounts;
CREATE POLICY "ledger_accounts_household" ON public.ledger_accounts
  FOR ALL USING (public.is_household_member(household_id))
  WITH CHECK (public.is_household_member(household_id));

DROP POLICY IF EXISTS "accounts_household_privacy" ON public.accounts;
CREATE POLICY "accounts_household_privacy" ON public.accounts
  FOR ALL USING (
    public.is_household_member(household_id)
    AND (is_private = FALSE OR owner_user_id = auth.uid())
  )
  WITH CHECK (
    public.is_household_member(household_id)
    AND (is_private = FALSE OR owner_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "categories_household" ON public.categories;
CREATE POLICY "categories_household" ON public.categories
  FOR ALL USING (public.is_household_member(household_id))
  WITH CHECK (public.is_household_member(household_id));

DROP POLICY IF EXISTS "transactions_household" ON public.transactions;
CREATE POLICY "transactions_household" ON public.transactions
  FOR ALL USING (public.is_household_member(household_id))
  WITH CHECK (public.is_household_member(household_id));

DROP POLICY IF EXISTS "transaction_transfers_household" ON public.transaction_transfers;
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

DROP POLICY IF EXISTS "journal_entries_household" ON public.journal_entries;
CREATE POLICY "journal_entries_household" ON public.journal_entries
  FOR ALL USING (public.is_household_member(household_id))
  WITH CHECK (public.is_household_member(household_id));

DROP POLICY IF EXISTS "journal_lines_household" ON public.journal_lines;
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

DROP POLICY IF EXISTS "budgets_household" ON public.budgets;
CREATE POLICY "budgets_household" ON public.budgets
  FOR ALL USING (public.is_household_member(household_id))
  WITH CHECK (public.is_household_member(household_id));

DROP POLICY IF EXISTS "assets_household" ON public.assets;
CREATE POLICY "assets_household" ON public.assets
  FOR ALL USING (public.is_household_member(household_id))
  WITH CHECK (public.is_household_member(household_id));

DROP POLICY IF EXISTS "liabilities_household" ON public.liabilities;
CREATE POLICY "liabilities_household" ON public.liabilities
  FOR ALL USING (public.is_household_member(household_id))
  WITH CHECK (public.is_household_member(household_id));

DROP POLICY IF EXISTS "debt_payments_household" ON public.debt_payments;
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

DROP POLICY IF EXISTS "debt_schedules_household" ON public.debt_schedules;
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

DROP POLICY IF EXISTS "debt_rate_history_household" ON public.debt_rate_history;
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

DROP POLICY IF EXISTS "recurring_rules_household" ON public.recurring_rules;
CREATE POLICY "recurring_rules_household" ON public.recurring_rules
  FOR ALL USING (public.is_household_member(household_id))
  WITH CHECK (public.is_household_member(household_id));

DROP POLICY IF EXISTS "attachments_household" ON public.attachments;
CREATE POLICY "attachments_household" ON public.attachments
  FOR ALL USING (public.is_household_member(household_id))
  WITH CHECK (public.is_household_member(household_id));

DROP POLICY IF EXISTS "audit_logs_household_select" ON public.audit_logs;
CREATE POLICY "audit_logs_household_select" ON public.audit_logs
  FOR SELECT USING (public.is_household_member(household_id));

DROP POLICY IF EXISTS "audit_logs_household_insert" ON public.audit_logs;
CREATE POLICY "audit_logs_household_insert" ON public.audit_logs
  FOR INSERT WITH CHECK (public.is_household_member(household_id));

DROP POLICY IF EXISTS "sync_operations_household" ON public.sync_operations;
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
