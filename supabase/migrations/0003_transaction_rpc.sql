-- FINORA — Atomic Transaction Posting & Reversal RPCs
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
