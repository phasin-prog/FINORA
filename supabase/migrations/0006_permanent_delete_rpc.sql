-- FINORA v1.3 — Permanent Transaction Delete RPC
-- PostgreSQL / Supabase Migration 0006

-- Allow authorized permanent deletion inside delete_finora_transaction_permanently()
CREATE OR REPLACE FUNCTION public.prevent_posted_journal_line_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF current_setting('finora.allow_permanent_delete', true) = 'true' THEN
    RETURN OLD;
  END IF;

  SELECT status INTO v_status
  FROM public.journal_entries
  WHERE id = OLD.journal_entry_id;

  IF v_status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION 'Cannot modify or delete lines of a % journal entry (%). Use reversal instead.', v_status, OLD.journal_entry_id;
  END IF;

  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_posted_journal_entry_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('finora.allow_permanent_delete', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

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

CREATE OR REPLACE FUNCTION public.delete_finora_transaction_permanently(
  p_transaction_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_tx RECORD;
  v_related_ids UUID[];
  v_journal_ids UUID[];
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_tx
  FROM public.transactions
  WHERE id = p_transaction_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', FALSE, 'reason', 'not_found');
  END IF;

  IF NOT public.is_household_member(v_tx.household_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Collect the transaction and any reversal child transactions
  SELECT ARRAY_AGG(id), ARRAY_AGG(journal_entry_id)
  INTO v_related_ids, v_journal_ids
  FROM public.transactions
  WHERE id = p_transaction_id OR reversed_transaction_id = p_transaction_id;

  PERFORM set_config('finora.allow_permanent_delete', 'true', true);

  -- Detach foreign key before deleting journal entries
  UPDATE public.transactions
  SET journal_entry_id = NULL
  WHERE id = ANY(v_related_ids);

  DELETE FROM public.transaction_transfers
  WHERE transaction_id = ANY(v_related_ids);

  DELETE FROM public.transactions
  WHERE id = ANY(v_related_ids);

  IF v_journal_ids IS NOT NULL THEN
    DELETE FROM public.journal_lines
    WHERE journal_entry_id = ANY(v_journal_ids);

    DELETE FROM public.journal_entries
    WHERE id = ANY(v_journal_ids);
  END IF;

  INSERT INTO public.audit_logs (household_id, actor_user_id, entity_type, entity_id, action, payload)
  VALUES (
    v_tx.household_id, v_user_id, 'transaction', p_transaction_id, 'PERMANENT_DELETE',
    jsonb_build_object('amount', v_tx.amount, 'description', v_tx.description)
  );

  RETURN jsonb_build_object('deleted', TRUE, 'transaction_id', p_transaction_id);
END;
$$;
