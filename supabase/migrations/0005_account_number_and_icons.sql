-- FINORA v1.2 — Account Number & Icon Metadata
-- PostgreSQL / Supabase Migration 0005

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS account_number TEXT,
  ADD COLUMN IF NOT EXISTS icon TEXT;
