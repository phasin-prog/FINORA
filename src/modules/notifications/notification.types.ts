export type NotificationPriority =
  | 'urgent'
  | 'important'
  | 'informational'
  | 'system';

export type NotificationStatus = 'scheduled' | 'sent' | 'read' | 'cancelled';

export type NotificationChannel = 'in_app' | 'web_push' | 'both';

export type NotificationTypeKey =
  | 'debt_due_7d'
  | 'debt_due_3d'
  | 'debt_due_1d'
  | 'debt_due_today'
  | 'debt_overdue'
  | 'budget_80'
  | 'budget_100'
  | 'income_reminder'
  | 'recurring_1d'
  | 'system_sync';

export interface NotificationPreferenceRecord {
  id: string;
  user_id: string;
  notification_type: NotificationTypeKey;
  label: string;
  is_enabled: boolean;
  days_before: number;
  preferred_time: string; // HH:mm
  channel: NotificationChannel;
  created_at: string;
  updated_at: string;
}

export interface NotificationRecord {
  id: string;
  user_id: string;
  household_id: string;
  event_id: string | null;
  related_liability_id?: string | null;
  notification_type: NotificationTypeKey;
  title: string;
  message: string;
  priority: NotificationPriority;
  scheduled_at: string;
  sent_at: string | null;
  read_at: string | null;
  status: NotificationStatus;
  deduplication_key: string;
  created_at: string;
}
