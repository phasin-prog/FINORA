-- FINORA v1.1 Addendum — Notification Center & Monthly Financial Calendar
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
